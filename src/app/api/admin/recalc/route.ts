/**
 * POST /api/admin/recalc
 * Recalcula scores_cache para todos los participantes desde cero.
 * Incluye grupos, clasificados, semis y preguntas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  scoreGroupMatch,
  scoreQualify,
  scoreSemis,
  scoreQuestions,
  type QualifyOfficial,
  type SemisOfficial,
  type QuestionOfficial,
} from '@/lib/scoring'
import type { Puesto, PreguntaKey } from '@/types'

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

    // ── Cargar datos ──────────────────────────────────────────
    const [
      { data: participants },
      { data: finishedMatches },
      { data: allGroupPreds },
      { data: allQualPreds },
      { data: allSemiPreds },
      { data: allQuestionPreds },
      { data: officialResults },
    ] = await Promise.all([
      db.from('participants').select('id'),
      db.from('matches').select('id, fase, match_index, goles_local, goles_visitante').eq('estado', 'finished').not('goles_local', 'is', null),
      db.from('predictions_group').select('participant_id, match_id, pred_local, pred_visitante'),
      db.from('predictions_qualify').select('participant_id, grupo, posicion, team_id, teams!inner(nombre)'),
      db.from('predictions_semis').select('participant_id, puesto, team_id, teams!inner(nombre)'),
      db.from('predictions_questions').select('participant_id, pregunta_key, respuesta'),
      db.from('official_results').select('scope, key, value'),
    ])

    if (!participants) {
      return NextResponse.json({ error: 'No se pudo cargar participantes' }, { status: 500 })
    }

    // Construir mapas de resultados oficiales
    const qualifyOfficial = buildQualifyOfficial(officialResults ?? [])
    const semisOfficial = buildSemisOfficial(officialResults ?? [])
    const questionOfficial = buildQuestionOfficial(officialResults ?? [])

    // Separar resultados de grupos vs eliminación, y la eliminación por RONDA
    // (misma regla de marcador para todos; 'tercer_puesto' se pliega en 'final').
    type FinishedMatch = { id: string; fase: string; goles_local: number; goles_visitante: number }
    type RoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'final'
    const FASE_TO_ROUND: Record<string, RoundKey> = {
      dieciseisavos: 'r32',
      octavos: 'r16',
      cuartos: 'qf',
      semis: 'sf',
      final: 'final',
      tercer_puesto: 'final',
    }
    const grupoResultMap = new Map<string, { golesLocal: number; golesVisitante: number }>()
    const elimResultMap = new Map<string, { golesLocal: number; golesVisitante: number }>()
    const roundResultMaps: Record<RoundKey, Map<string, { golesLocal: number; golesVisitante: number }>> = {
      r32: new Map(), r16: new Map(), qf: new Map(), sf: new Map(), final: new Map(),
    }
    for (const m of (finishedMatches ?? []) as FinishedMatch[]) {
      const res = { golesLocal: m.goles_local, golesVisitante: m.goles_visitante }
      if (m.fase === 'grupos') {
        grupoResultMap.set(m.id, res)
      } else {
        elimResultMap.set(m.id, res)
        const round = FASE_TO_ROUND[m.fase]
        if (round) roundResultMaps[round].set(m.id, res)
      }
    }

    // Agrupar pronósticos por participante
    const groupPredsByPart = groupBy(allGroupPreds ?? [], 'participant_id')
    const qualPredsByPart = groupBy(allQualPreds ?? [], 'participant_id')
    const semiPredsByPart = groupBy(allSemiPreds ?? [], 'participant_id')
    const questionPredsByPart = groupBy(allQuestionPreds ?? [], 'participant_id')

    // Calcular y actualizar
    const updates = []
    for (const p of participants) {
      type QualPred = { grupo: string; posicion: number; teams: { nombre: string } }
      type SemiPred = { puesto: string; teams: { nombre: string } }
      const partPreds = groupPredsByPart.get(p.id) ?? []
      const totalGrupos = calcGroups(partPreds, grupoResultMap)
      // Subtotales por ronda (chips de la tabla). total_eliminacion = suma de los 5.
      const totalR32 = calcGroups(partPreds, roundResultMaps.r32)
      const totalR16 = calcGroups(partPreds, roundResultMaps.r16)
      const totalQf = calcGroups(partPreds, roundResultMaps.qf)
      const totalSf = calcGroups(partPreds, roundResultMaps.sf)
      const totalFinalRound = calcGroups(partPreds, roundResultMaps.final)
      const totalEliminacion = totalR32 + totalR16 + totalQf + totalSf + totalFinalRound
      const totalClasificados = calcQualify((qualPredsByPart.get(p.id) ?? []) as unknown as QualPred[], qualifyOfficial)
      const totalSemis = calcSemis((semiPredsByPart.get(p.id) ?? []) as unknown as SemiPred[], semisOfficial)
      const totalPreguntas = calcQuestions(questionPredsByPart.get(p.id) ?? [], questionOfficial)
      const total = totalGrupos + totalEliminacion + totalClasificados + totalSemis + totalPreguntas

      updates.push({
        participant_id: p.id,
        total,
        total_grupos: totalGrupos,
        total_eliminacion: totalEliminacion,
        total_r32: totalR32,
        total_r16: totalR16,
        total_qf: totalQf,
        total_sf: totalSf,
        total_final: totalFinalRound,
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

