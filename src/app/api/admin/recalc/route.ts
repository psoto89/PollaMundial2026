/**
 * POST /api/admin/recalc
 * Recalcula scores_cache para todos los participantes desde cero.
 * Incluye grupos, clasificados, semis y preguntas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncSemisFromResults } from '@/lib/autoSemis'
import {
  scoreGroupMatch,
  scoreQualify,
  scoreSemis,
  scoreQuestions,
  scoreKnockoutMatch,
  deriveAdvancer,
  scoreBracketBonuses,
  type QualifyOfficial,
  type SemisOfficial,
  type QuestionOfficial,
  type BracketOfficial,
  type BracketPicks,
} from '@/lib/scoring'
import type { Puesto, PreguntaKey } from '@/types'

// Prefijo de slot → bucket de ronda en scores_cache (3P y F se pliegan en 'final')
type RoundBucket = 'r32' | 'r16' | 'qf' | 'sf' | 'final'
function slotBucket(slot: string): RoundBucket | null {
  if (slot.startsWith('R32-')) return 'r32'
  if (slot.startsWith('R16-')) return 'r16'
  if (slot.startsWith('QF-')) return 'qf'
  if (slot.startsWith('SF-')) return 'sf'
  if (slot === '3P' || slot === 'F') return 'final'
  return null
}

export async function POST(req: NextRequest) {
  try {
    // Aceptar dos formas de autenticación:
    // 1. Cookie de sesión admin (uso desde browser en /admin)
    // 2. Header x-internal-secret (uso server-to-server desde /api/webhooks/live)
    const internalSecret = req.headers.get('x-internal-secret')
    const isInternalCall = internalSecret && internalSecret === process.env.ADMIN_SESSION_SECRET

    if (!isInternalCall) {
      const isAdmin = await verifyAdminSession()
      if (!isAdmin) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
      }
    }

    const db = createAdminClient()

    // Derivar semifinalistas/puestos finales de la Polla 1 desde los resultados
    // ya finalizados (official_results scope='semis'), para que el recálculo —
    // incluido el botón manual "Recalcular puntos" — quede autocontenido y
    // aplique los +10 sin depender de un sync previo. Idempotente y no bloqueante.
    try {
      await syncSemisFromResults(db)
    } catch (e) {
      console.error('[recalc] auto-semis falló (no bloqueante)', e)
    }

    // ── Cargar datos ──────────────────────────────────────────
    const [
      { data: participants },
      { data: finishedMatches },
      { data: allGroupPreds },
      { data: allBracketPreds },
      { data: allQualPreds },
      { data: allSemiPreds },
      { data: allQuestionPreds },
      { data: officialResults },
      { data: cfg },
    ] = await Promise.all([
      db.from('participants').select('id'),
      db.from('matches')
        .select('id, fase, bracket_slot, kickoff_at, goles_local, goles_visitante, advancer_team_id, equipo_local_id, equipo_visitante_id')
        .eq('estado', 'finished').not('goles_local', 'is', null),
      db.from('predictions_group').select('participant_id, match_id, pred_local, pred_visitante'),
      db.from('predictions_bracket').select('participant_id, slot, advancer_team_id, pred_local, pred_visitante'),
      db.from('predictions_qualify').select('participant_id, grupo, posicion, team_id, teams!inner(nombre)'),
      db.from('predictions_semis').select('participant_id, puesto, team_id, teams!inner(nombre)'),
      db.from('predictions_questions').select('participant_id, pregunta_key, respuesta'),
      db.from('official_results').select('scope, key, value'),
      db.from('app_config').select('bracket_activated_at').single(),
    ])

    if (!participants) {
      return NextResponse.json({ error: 'No se pudo cargar participantes' }, { status: 500 })
    }

    // Construir mapas de resultados oficiales
    const qualifyOfficial = buildQualifyOfficial(officialResults ?? [])
    const semisOfficial = buildSemisOfficial(officialResults ?? [])
    const questionOfficial = buildQuestionOfficial(officialResults ?? [])

    // ── Grupos: marcador por partido (sin cambios) ──────────────
    type FinishedMatch = {
      id: string; fase: string; bracket_slot: string | null; kickoff_at: string | null
      goles_local: number; goles_visitante: number
      advancer_team_id: string | null
      equipo_local_id: string | null; equipo_visitante_id: string | null
    }
    const finished = (finishedMatches ?? []) as FinishedMatch[]
    const grupoResultMap = new Map<string, { golesLocal: number; golesVisitante: number }>()
    for (const m of finished) {
      if (m.fase === 'grupos') {
        grupoResultMap.set(m.id, { golesLocal: m.goles_local, golesVisitante: m.goles_visitante })
      }
    }

    // ── Eliminación (Polla 2 = bracket): solo partidos que "participan" ──
    // "Desde hoy hacia adelante": un partido participa si arranca después de la
    // activación de la polla (o si no hay activación configurada).
    const activatedAt = (cfg as { bracket_activated_at: string | null } | null)?.bracket_activated_at ?? null
    const participates = (m: FinishedMatch): boolean => {
      if (!activatedAt) return true
      if (!m.kickoff_at) return true
      return new Date(m.kickoff_at).getTime() >= new Date(activatedAt).getTime()
    }

    // Partido real por slot (solo knockout finalizados y participantes)
    type SlotMatch = {
      bucket: RoundBucket; golesLocal: number; golesVisitante: number
      advancer: string | null; localId: string | null; visitanteId: string | null
    }
    const slotMatches = new Map<string, SlotMatch>()
    for (const m of finished) {
      if (m.fase === 'grupos' || !m.bracket_slot || !participates(m)) continue
      const bucket = slotBucket(m.bracket_slot)
      if (!bucket) continue
      slotMatches.set(m.bracket_slot, {
        bucket,
        golesLocal: m.goles_local,
        golesVisitante: m.goles_visitante,
        // El que avanza se deriva del marcador (gana → pasa); empate → el explícito (penales)
        advancer: deriveAdvancer(m.goles_local, m.goles_visitante, m.equipo_local_id, m.equipo_visitante_id, m.advancer_team_id),
        localId: m.equipo_local_id,
        visitanteId: m.equipo_visitante_id,
      })
    }

    // Conjuntos oficiales para los bonos de cuadro (team_id), derivados de advancer_team_id
    const bracketOfficial: BracketOfficial = {
      octavos: [], cuartos: [], semis: [],
      campeon: null, subcampeon: null, tercero: null,
    }
    for (const [slot, sm] of slotMatches) {
      if (!sm.advancer) continue
      if (slot.startsWith('R32-')) bracketOfficial.octavos.push(sm.advancer)
      else if (slot.startsWith('R16-')) bracketOfficial.cuartos.push(sm.advancer)
      else if (slot.startsWith('QF-')) bracketOfficial.semis.push(sm.advancer)
      else if (slot === '3P') bracketOfficial.tercero = sm.advancer
      else if (slot === 'F') {
        bracketOfficial.campeon = sm.advancer
        // Subcampeón = el otro finalista (el que no avanzó de la Final)
        const otro = sm.advancer === sm.localId ? sm.visitanteId : sm.localId
        bracketOfficial.subcampeon = otro
      }
    }

    // Agrupar pronósticos por participante
    const groupPredsByPart = groupBy(allGroupPreds ?? [], 'participant_id')
    const bracketPredsByPart = groupBy(allBracketPreds ?? [], 'participant_id')
    const qualPredsByPart = groupBy(allQualPreds ?? [], 'participant_id')
    const semiPredsByPart = groupBy(allSemiPreds ?? [], 'participant_id')
    const questionPredsByPart = groupBy(allQuestionPreds ?? [], 'participant_id')

    // Calcular y actualizar
    const updates = []
    for (const p of participants) {
      type QualPred = { grupo: string; posicion: number; teams: { nombre: string } }
      type SemiPred = { puesto: string; teams: { nombre: string } }
      type BracketPred = { slot: string; advancer_team_id: string | null; pred_local: number | null; pred_visitante: number | null }

      const partPreds = groupPredsByPart.get(p.id) ?? []
      const totalGrupos = calcGroups(partPreds, grupoResultMap)

      // ── Eliminación: puntos por partido (por ronda) + bonos de cuadro ──
      const bracketPreds = (bracketPredsByPart.get(p.id) ?? []) as unknown as BracketPred[]
      // El avance del usuario se deriva de SU marcador (gana → pasa); empate → el explícito.
      const effectiveBracketPreds = bracketPreds.map((b) => {
        const sm = slotMatches.get(b.slot)
        const adv = sm
          ? deriveAdvancer(b.pred_local, b.pred_visitante, sm.localId, sm.visitanteId, b.advancer_team_id)
          : b.advancer_team_id
        return { ...b, advancer_team_id: adv }
      })
      const pickBySlot = new Map(effectiveBracketPreds.map((b) => [b.slot, b]))

      const rounds: Record<RoundBucket, number> = { r32: 0, r16: 0, qf: 0, sf: 0, final: 0 }
      for (const [slot, sm] of slotMatches) {
        const pick = pickBySlot.get(slot)
        if (!pick) continue
        const ds = scoreKnockoutMatch(
          { predLocal: pick.pred_local, predVisitante: pick.pred_visitante, advancer: pick.advancer_team_id },
          { golesLocal: sm.golesLocal, golesVisitante: sm.golesVisitante, advancer: sm.advancer },
        )
        rounds[sm.bucket] += ds.total
      }

      const bonos = scoreBracketBonuses(buildBracketPicks(effectiveBracketPreds), bracketOfficial)
      const totalEliminacion =
        rounds.r32 + rounds.r16 + rounds.qf + rounds.sf + rounds.final + bonos.total

      const totalClasificados = calcQualify((qualPredsByPart.get(p.id) ?? []) as unknown as QualPred[], qualifyOfficial)
      const totalSemis = calcSemis((semiPredsByPart.get(p.id) ?? []) as unknown as SemiPred[], semisOfficial)
      const totalPreguntas = calcQuestions(questionPredsByPart.get(p.id) ?? [], questionOfficial)
      const total = totalGrupos + totalEliminacion + totalClasificados + totalSemis + totalPreguntas

      updates.push({
        participant_id: p.id,
        total,
        total_grupos: totalGrupos,
        total_eliminacion: totalEliminacion,
        total_r32: rounds.r32,
        total_r16: rounds.r16,
        total_qf: rounds.qf,
        total_sf: rounds.sf,
        total_final: rounds.final,
        total_bono_octavos: bonos.octavos,
        total_bono_cuartos: bonos.cuartos,
        total_bono_semis: bonos.semis,
        total_bono_finales: bonos.campeon + bonos.subcampeon + bonos.tercero,
        total_clasificados: totalClasificados,
        total_semis: totalSemis,
        total_preguntas: totalPreguntas,
        updated_at: new Date().toISOString(),
      })
    }

    if (updates.length > 0) {
      const { error } = await db
        .from('scores_cache')
        .upsert(updates, { onConflict: 'participant_id' })
      if (error) throw new Error(`scores_cache upsert: ${error.message}`)
    }

    return NextResponse.json({ ok: true, updated: updates.length })
  } catch (error) {
    console.error('[POST /api/admin/recalc]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ─── Helpers de cálculo ───────────────────────────────────────

/**
 * Arma los picks de cuadro de un participante a partir de sus filas de
 * predictions_bracket. Los equipos se identifican por team_id.
 *   - octavos = advancers de R32-*  · cuartos = R16-*  · semis = QF-*
 *   - campeón = advancer de F · tercero = advancer de 3P
 *   - subcampeón = el finalista (advancer de SF-1/SF-2) que NO es el campeón
 */
function buildBracketPicks(
  preds: { slot: string; advancer_team_id: string | null }[],
): BracketPicks {
  const advBySlot = new Map(preds.map((b) => [b.slot, b.advancer_team_id]))
  const octavos: string[] = []
  const cuartos: string[] = []
  const semis: string[] = []
  for (const { slot, advancer_team_id } of preds) {
    if (!advancer_team_id) continue
    if (slot.startsWith('R32-')) octavos.push(advancer_team_id)
    else if (slot.startsWith('R16-')) cuartos.push(advancer_team_id)
    else if (slot.startsWith('QF-')) semis.push(advancer_team_id)
  }
  const campeon = advBySlot.get('F') ?? null
  const tercero = advBySlot.get('3P') ?? null
  const finalistas = [advBySlot.get('SF-1'), advBySlot.get('SF-2')].filter(Boolean) as string[]
  // El subcampeón solo se puede inferir si el usuario eligió campeón Y ese campeón es
  // uno de sus dos finalistas. Si no, queda null (evita acreditar +15 sin pronosticar la final).
  const subcampeon =
    campeon && finalistas.includes(campeon)
      ? finalistas.find((t) => t !== campeon) ?? null
      : null
  return { octavos, cuartos, semis, campeon, subcampeon, tercero }
}

function calcGroups(
  preds: { match_id: string; pred_local: number; pred_visitante: number }[],
  matchResultMap: Map<string, { golesLocal: number; golesVisitante: number }>,
): number {
  let total = 0
  for (const pred of preds) {
    const result = matchResultMap.get(pred.match_id)
    if (!result) continue
    total += scoreGroupMatch(
      { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
      { golesLocal: result.golesLocal, golesVisitante: result.golesVisitante },
    ).total
  }
  return total
}

function calcQualify(
  preds: { grupo: string; posicion: number; teams: { nombre: string } }[],
  official: QualifyOfficial,
): number {
  if (!official.classified || Object.keys(official.classified).length === 0) return 0
  return scoreQualify(
    preds.map((p) => ({
      grupo: p.grupo,
      posicion: p.posicion as 1 | 2 | 3,
      teamNombre: p.teams.nombre,
    })),
    official,
  ).total
}

function calcSemis(
  preds: { puesto: string; teams: { nombre: string } }[],
  official: SemisOfficial,
): number {
  if (!official.semifinalistas || official.semifinalistas.length === 0) return 0
  return scoreSemis(
    preds.map((p) => ({ puesto: p.puesto as Puesto, teamNombre: p.teams.nombre })),
    official,
  ).total
}

function calcQuestions(
  preds: { pregunta_key: string; respuesta: string | null }[],
  official: QuestionOfficial,
): number {
  if (!official.respuestas || Object.keys(official.respuestas).length === 0) return 0
  return scoreQuestions(
    preds.map((p) => ({ key: p.pregunta_key as PreguntaKey, respuesta: p.respuesta })),
    official,
  ).total
}

// ─── Builders de official ─────────────────────────────────────

function buildQualifyOfficial(
  rows: { scope: string; key: string; value: Record<string, unknown> }[],
): QualifyOfficial {
  const official: QualifyOfficial = { classified: {}, bestThirds: [] }
  for (const row of rows) {
    if (row.scope !== 'qualify') continue
    const [grupo, posStr] = row.key.split(':')
    const pos = parseInt(posStr, 10) as 1 | 2 | 3
    const team = String((row.value as { team?: string }).team ?? '')
    if (!team) continue
    if (pos === 3) {
      official.bestThirds.push(team)
    } else {
      official.classified[team] = { grupo, posicion: pos as 1 | 2 }
    }
  }
  return official
}

function buildSemisOfficial(
  rows: { scope: string; key: string; value: Record<string, unknown> }[],
): SemisOfficial {
  const official: SemisOfficial = {
    semifinalistas: [],
    puestosExactos: {} as Record<Puesto, string>,
  }
  for (const row of rows) {
    if (row.scope !== 'semis') continue
    const team = String((row.value as { team?: string }).team ?? '')
    if (!team) continue
    official.puestosExactos[row.key as Puesto] = team
    if (!official.semifinalistas.includes(team)) {
      official.semifinalistas.push(team)
    }
  }
  return official
}

function buildQuestionOfficial(
  rows: { scope: string; key: string; value: Record<string, unknown> }[],
): QuestionOfficial {
  const official: QuestionOfficial = {
    respuestas: {} as Record<PreguntaKey, string | number | null>,
  }
  for (const row of rows) {
    if (row.scope !== 'question') continue
    const v = row.value as { answer?: string | number }
    official.respuestas[row.key as PreguntaKey] = v.answer ?? null
  }
  return official
}

function groupBy<T extends Record<string, unknown>>(
  arr: T[],
  key: string,
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of arr) {
    const k = String(item[key])
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

