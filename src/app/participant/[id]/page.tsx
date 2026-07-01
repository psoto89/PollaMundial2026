import { createClient } from '@/lib/supabase/server'
import { scoreGroupMatch, scoreQualify, scoreSemis, scoreKnockoutMatch, deriveAdvancer, answersMatch, type QualifyOfficial } from '@/lib/scoring'
import { computeGroupStandings } from '@/lib/standings'
import { ROUND_LABELS, ROUND_ORDER, type RoundKey } from '@/config/bracket2026'
import PollaTabs from './PollaTabs'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Puesto, PreguntaKey } from '@/types'

export const revalidate = 60

interface Props {
  params: Promise<{ id: string }>
}

interface GroupPredRow {
  pred_local: number
  pred_visitante: number
  matches: {
    id: string
    fase: string | null
    grupo: string | null
    goles_local: number | null
    goles_visitante: number | null
    estado: string
    equipo_local: { nombre: string } | null
    equipo_visitante: { nombre: string } | null
  } | null
}

interface QualifyPredRow {
  grupo: string
  posicion: number
  teams: { nombre: string } | null
}

interface SemisPredRow {
  puesto: string
  teams: { nombre: string } | null
}

interface QuestionPredRow {
  pregunta_key: string
  respuesta: string | null
}

interface OfficialRow {
  scope: string
  key: string
  value: Record<string, unknown>
}

const QUESTION_LABELS: Record<string, string> = {
  p1: '¿Primer gol del Mundial?',
  p2: '¿Goleador del Mundial?',
  p3: '¿Goles del goleador?',
  p4: '¿Máximo asistidor?',
  p5: '¿Equipo con más goles?',
  p6: '¿Goles en la Final?',
}

const PUESTO_LABELS: Record<string, string> = {
  campeon: '🥇 Campeón',
  subcampeon: '🥈 Subcampeón',
  '3': '🥉 3er puesto',
  '4': '4to puesto',
}

const PUESTO_ORDER: Record<string, number> = { campeon: 0, subcampeon: 1, '3': 2, '4': 3 }
const POSICION_LABELS: Record<number, string> = { 1: '1°', 2: '2°', 3: '3° ↗' }

// ─── Builders de resultados oficiales ────────────────────────────────────────

function buildQualifyOfficial(rows: OfficialRow[]) {
  const official = {
    classified: {} as Record<string, { grupo: string; posicion: 1 | 2 }>,
    bestThirds: [] as string[],
  }
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

function buildSemisOfficial(rows: OfficialRow[]) {
  const official = {
    semifinalistas: [] as string[],
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

/**
 * Clasificados PROVISIONALES (1º/2º) de los grupos que tienen partido en vivo y
 * todavía no son oficiales. Reusa los partidos reales que ya vienen en groupPreds
 * (no consulta extra) y la misma tabla de posiciones (computeGroupStandings).
 * Los mejores terceros no son tentativos: solo se saben al cerrar los 12 grupos.
 */
function buildProvisionalQualify(groupPreds: GroupPredRow[], official: QualifyOfficial) {
  const matchesByGroup = new Map<string, GroupPredRow['matches'][]>()
  for (const gp of groupPreds) {
    const m = gp.matches
    if (!m || !m.grupo) continue
    const list = matchesByGroup.get(m.grupo) ?? []
    list.push(m)
    matchesByGroup.set(m.grupo, list)
  }

  // Grupos ya oficiales (cerrados) → no tentativo
  const officialGroups = new Set(Object.values(official.classified).map((c) => c.grupo))

  const classified: QualifyOfficial['classified'] = {}
  const liveGroups = new Set<string>()

  for (const [grupo, ms] of matchesByGroup) {
    if (officialGroups.has(grupo)) continue
    if (!ms.some((m) => m?.estado === 'live')) continue // solo grupos con partido en vivo
    liveGroups.add(grupo)

    const teamNames = new Set<string>()
    const standingMatches = []
    for (const m of ms) {
      if (!m) continue
      const local = m.equipo_local?.nombre
      const visita = m.equipo_visitante?.nombre
      if (local) teamNames.add(local)
      if (visita) teamNames.add(visita)
      if (local && visita && m.goles_local !== null && m.goles_visitante !== null) {
        standingMatches.push({
          equipoLocalId: local,
          equipoVisitanteId: visita,
          golesLocal: m.goles_local,
          golesVisitante: m.goles_visitante,
        })
      }
    }
    if (standingMatches.length === 0) continue

    const teamsList = [...teamNames].map((n) => ({ teamId: n, teamNombre: n, grupo }))
    const { rows } = computeGroupStandings(standingMatches, teamsList)
    const p1 = rows.find((r) => r.posicion === 1)
    const p2 = rows.find((r) => r.posicion === 2)
    if (p1) classified[p1.teamNombre] = { grupo, posicion: 1 }
    if (p2) classified[p2.teamNombre] = { grupo, posicion: 2 }
  }

  return { official: { classified, bestThirds: [] } as QualifyOfficial, liveGroups }
}

export default async function ParticipantPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', id)
    .single()

  if (!participant) notFound()

  const [
    { data: scores },
    { data: groupPredsRaw },
    { data: qualifyPredsRaw },
    { data: semisPredsRaw },
    { data: questionPreds },
    { data: officialRaw },
  ] = await Promise.all([
    supabase.from('scores_cache').select('*').eq('participant_id', id).single(),
    supabase
      .from('predictions_group')
      .select(`
        pred_local, pred_visitante,
        matches(
          id, fase, grupo, goles_local, goles_visitante, estado,
          equipo_local:teams!equipo_local_id(nombre),
          equipo_visitante:teams!equipo_visitante_id(nombre)
        )
      `)
      .eq('participant_id', id),
    supabase
      .from('predictions_qualify')
      .select('grupo, posicion, teams(nombre)')
      .eq('participant_id', id)
      .order('grupo')
      .order('posicion'),
    supabase
      .from('predictions_semis')
      .select('puesto, teams(nombre)')
      .eq('participant_id', id),
    supabase
      .from('predictions_questions')
      .select('pregunta_key, respuesta')
      .eq('participant_id', id)
      .order('pregunta_key'),
    supabase
      .from('official_results')
      .select('scope, key, value'),
  ])

  // ─── Polla 2 · Cuadro eliminatorio (predictions_bracket) ───────────────────
  const { data: bracketPredsRaw } = await supabase
    .from('predictions_bracket')
    .select('slot, advancer_team_id, pred_local, pred_visitante, advancer:teams!advancer_team_id(nombre)')
    .eq('participant_id', id)
  const bracketPreds = (bracketPredsRaw ?? []) as unknown as {
    slot: string; advancer_team_id: string | null
    pred_local: number | null; pred_visitante: number | null
    advancer: { nombre: string } | null
  }[]

  type BracketRow = {
    slot: string; round: RoundKey; matchNo: number
    localName: string; visitanteName: string
    predLocal: number | null; predVisitante: number | null
    advancerName: string | null; advancerId: string | null
    finished: boolean; live: boolean
    golesLocal: number | null; golesVisitante: number | null
    officialAdvancerId: string | null
    pts: number | null; acertoAdvancer: boolean
  }
  const bracketByRound = new Map<RoundKey, BracketRow[]>()
  if (bracketPreds.length > 0) {
    const slots = bracketPreds.map((p) => p.slot)
    const { data: bMatchesRaw } = await supabase
      .from('matches')
      .select(`
        bracket_slot, fase, kickoff_at, goles_local, goles_visitante, estado, advancer_team_id,
        equipo_local:teams!equipo_local_id(id, nombre),
        equipo_visitante:teams!equipo_visitante_id(id, nombre)
      `)
      .in('bracket_slot', slots)
    type BMatch = {
      bracket_slot: string; fase: string; kickoff_at: string | null
      goles_local: number | null; goles_visitante: number | null; estado: string
      advancer_team_id: string | null
      equipo_local: { id: string; nombre: string } | null
      equipo_visitante: { id: string; nombre: string } | null
    }
    const bySlot = new Map(((bMatchesRaw ?? []) as unknown as BMatch[]).map((m) => [m.bracket_slot, m]))

    for (const p of bracketPreds) {
      const m = bySlot.get(p.slot)
      if (!m) continue
      const finished = m.estado === 'finished'
      const live = m.estado === 'live'
      const localId = m.equipo_local?.id ?? null
      const visitanteId = m.equipo_visitante?.id ?? null
      // El que avanza se deriva del marcador (gana → pasa); el empate usa el explícito.
      const predAdvancer = deriveAdvancer(p.pred_local, p.pred_visitante, localId, visitanteId, p.advancer_team_id)
      const officialAdvancer = deriveAdvancer(m.goles_local, m.goles_visitante, localId, visitanteId, m.advancer_team_id)
      const score = (finished || live)
        ? scoreKnockoutMatch(
            { predLocal: p.pred_local, predVisitante: p.pred_visitante, advancer: predAdvancer },
            { golesLocal: m.goles_local, golesVisitante: m.goles_visitante, advancer: officialAdvancer },
          )
        : null
      const predAdvancerName = predAdvancer === localId ? m.equipo_local?.nombre
        : predAdvancer === visitanteId ? m.equipo_visitante?.nombre
        : p.advancer?.nombre ?? null
      const round = m.fase as RoundKey
      const arr = bracketByRound.get(round) ?? []
      arr.push({
        slot: p.slot, round, matchNo: 0,
        localName: m.equipo_local?.nombre ?? '—',
        visitanteName: m.equipo_visitante?.nombre ?? '—',
        predLocal: p.pred_local, predVisitante: p.pred_visitante,
        advancerName: predAdvancerName ?? null, advancerId: predAdvancer,
        finished, live,
        golesLocal: m.goles_local, golesVisitante: m.goles_visitante,
        officialAdvancerId: officialAdvancer,
        pts: score?.total ?? null,
        acertoAdvancer: !!((finished || live) && predAdvancer && officialAdvancer && predAdvancer === officialAdvancer),
      })
      bracketByRound.set(round, arr)
    }
  }
  const bracketRounds = ROUND_ORDER.filter((r) => bracketByRound.has(r))
  const bracketLiveDelta = [...bracketByRound.values()].flat()
    .reduce((s, r) => s + (r.live ? (r.pts ?? 0) : 0), 0)

  const groupPreds = (groupPredsRaw ?? []) as unknown as GroupPredRow[]
  const qualifyPreds = (qualifyPredsRaw ?? []) as unknown as QualifyPredRow[]
  const semisPreds = (semisPredsRaw ?? []) as unknown as SemisPredRow[]
  const qPreds = (questionPreds ?? []) as QuestionPredRow[]
  const officialRows = (officialRaw ?? []) as OfficialRow[]

  // Construir estructuras de resultados oficiales
  const qualifyOfficial = buildQualifyOfficial(officialRows)
  const semisOfficial = buildSemisOfficial(officialRows)
  const officialAnswers = new Map(
    officialRows
      .filter((r) => r.scope === 'question')
      .map((r) => [r.key, (r.value as { answer?: string | number }).answer ?? null]),
  )

  const hasQualifyOfficial = Object.keys(qualifyOfficial.classified).length > 0 || qualifyOfficial.bestThirds.length > 0
  const hasSemisOfficial = semisOfficial.semifinalistas.length > 0

  // Clasificados provisionales (1º/2º) de los grupos con partido en vivo
  const provisionalQualify = buildProvisionalQualify(groupPreds, qualifyOfficial)

  // Proyección de puntos por pick en Clasificados (definitivo + tentativo en vivo)
  const qualifyScorePerPick = qualifyPreds.map((pred) => {
    const teamNombre = pred.teams?.nombre ?? ''
    const pick = { grupo: pred.grupo, posicion: pred.posicion as 1 | 2 | 3, teamNombre }
    const pts = scoreQualify([pick], qualifyOfficial).total
    const isLiveGroup = provisionalQualify.liveGroups.has(pred.grupo)
    // Tentativo solo para 1º/2º (los terceros no se pueden anticipar)
    const tentativePts = isLiveGroup && pred.posicion !== 3
      ? scoreQualify([pick], provisionalQualify.official).total
      : 0
    return { ...pred, pts, tentativePts, isLiveGroup }
  })

  // Proyección de puntos por pick en Semis
  const semisScorePerPick = semisPreds.map((pred) => {
    const teamNombre = pred.teams?.nombre ?? ''
    const result = scoreSemis(
      [{ puesto: pred.puesto as Puesto, teamNombre }],
      semisOfficial,
    )
    return { ...pred, pts: result.total }
  })

  // Agrupar partidos por grupo
  const predsByGrupo = new Map<string, GroupPredRow[]>()
  for (const pred of groupPreds) {
    const g = pred.matches?.grupo ?? '?'
    if (!predsByGrupo.has(g)) predsByGrupo.set(g, [])
    predsByGrupo.get(g)!.push(pred)
  }
  const sortedGrupos = Array.from(predsByGrupo.keys()).sort()

  // Agrupar clasificados por grupo
  const qualifyByGrupo = new Map<string, typeof qualifyScorePerPick>()
  for (const pred of qualifyScorePerPick) {
    if (!qualifyByGrupo.has(pred.grupo)) qualifyByGrupo.set(pred.grupo, [])
    qualifyByGrupo.get(pred.grupo)!.push(pred)
  }
  const qualifyGrupos = Array.from(qualifyByGrupo.keys()).sort()

  const totalQualifyPts = qualifyScorePerPick.reduce((s, p) => s + p.pts, 0)
  const totalQualifyTentative = qualifyScorePerPick.reduce((s, p) => s + p.tentativePts, 0)
  const totalSemisPts = semisScorePerPick.reduce((s, p) => s + p.pts, 0)

  // Delta tentativo en vivo de la Polla 1: solo partidos de GRUPOS en vivo
  // (la eliminación es la Polla 2 y se calcula aparte con predictions_bracket).
  let liveGruposDelta = 0
  for (const pred of groupPreds) {
    const m = pred.matches
    if (!m || m.fase !== 'grupos' || m.estado !== 'live' || m.goles_local === null || m.goles_visitante === null) continue
    const pts = scoreGroupMatch(
      { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
      { golesLocal: m.goles_local, golesVisitante: m.goles_visitante },
    ).total
    if (pts > 0) liveGruposDelta += pts
  }

  // Total de la Polla 1 (grupos + clasificados + semis + preguntas). NO incluye la
  // eliminación: eso es la Polla 2 (cuadro), que va aparte en su propia pestaña.
  const polla1Persisted = ((scores?.total_grupos as number) ?? 0)
    + ((scores?.total_clasificados as number) ?? 0)
    + ((scores?.total_semis as number) ?? 0)
    + ((scores?.total_preguntas as number) ?? 0)
  const polla1Live = liveGruposDelta + totalQualifyTentative

  // ─── Panel Polla 2 (cuadro), se muestra en su pestaña ──────────────────────
  const polla2Panel = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-[#e6edf3]">🏆 Polla 2 · Cuadro</h2>
        <span className="inline-flex items-center gap-2">
          {bracketLiveDelta > 0 && (
            <span className="text-xs font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">+{bracketLiveDelta} en vivo</span>
          )}
          {scores && (
            // total_eliminacion ya incluye los bonos de cuadro (ver recalc: rounds + bonos.total).
            // No volver a sumar los total_bono_* aquí o se cuentan doble.
            <span className="text-sm font-bold text-[#9EE637]">
              +{(scores.total_eliminacion as number) ?? 0} pts
            </span>
          )}
        </span>
      </div>
      <p className="text-xs text-[#768390] mb-3">
        Marcador final (incluye alargue) = +5 exacto · +2 signo · +2 si aciertas quién pasa · más bonos de cuadro
      </p>
      <div className="space-y-3">
        {bracketRounds.map((round) => {
          const rows = bracketByRound.get(round) ?? []
          return (
            <div key={round}>
              <p className="text-xs font-semibold text-[#768390] uppercase tracking-wider mb-1.5">{ROUND_LABELS[round]}</p>
              <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
                {rows.map((r) => (
                  <div key={r.slot} className={`px-3 py-2.5 text-sm ${(r.pts ?? 0) > 0 ? 'bg-[#9EE637]/5' : ''}`}>
                    {/* Equipos + puntos de la fila */}
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-[#e6edf3]">
                        {r.localName} <span className="text-[#586069]">vs</span> {r.visitanteName}
                      </span>
                      <span className={`text-sm font-bold tabular-nums shrink-0 ${(r.pts ?? 0) > 0 ? 'text-[#9EE637]' : 'text-[#444d56]'}`}>
                        {r.pts !== null ? (r.pts > 0 ? `+${r.pts}` : '—') : '?'}
                      </span>
                    </div>
                    {/* Marcadores: tu pronóstico y el resultado real, separados y etiquetados */}
                    <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <span className="uppercase tracking-wide text-[10px] text-[#586069]">Tú</span>
                        <span className="font-mono text-[#9EE637]">{r.predLocal ?? '–'}–{r.predVisitante ?? '–'}</span>
                      </span>
                      {(r.finished || r.live) && (
                        <span className="inline-flex items-center gap-1 text-[11px]">
                          <span className="uppercase tracking-wide text-[10px] text-[#586069]">{r.live ? 'En vivo' : 'Final'}</span>
                          <span className="font-mono text-[#e6edf3]">{r.golesLocal ?? '–'}–{r.golesVisitante ?? '–'}</span>
                        </span>
                      )}
                      {r.advancerName && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          r.acertoAdvancer ? 'bg-[#9EE637]/20 text-[#9EE637]' : 'bg-[#21262d] text-[#768390]'
                        }`}>
                          {r.acertoAdvancer ? '✓ ' : ''}pasa {r.advancerName}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
        <h1 className="text-2xl font-bold text-[#e6edf3]">{participant.nombre}</h1>
      </div>

      <PollaTabs
        hasBracket={bracketRounds.length > 0}
        polla2={polla2Panel}
        polla1={
          <div className="space-y-8">
      {/* Resumen de puntos */}
      {scores && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: polla1Persisted + polla1Live, live: polla1Live, highlight: true },
            { label: 'Grupos', value: ((scores.total_grupos as number) ?? 0) + liveGruposDelta, live: liveGruposDelta },
            { label: 'Clasificados', value: ((scores.total_clasificados as number) ?? 0) + totalQualifyTentative, live: totalQualifyTentative },
            { label: 'Semis', value: (scores.total_semis as number) ?? 0, live: 0 },
            { label: 'Preguntas', value: (scores.total_preguntas as number) ?? 0, live: 0 },
          ].map(({ label, value, live, highlight }) => (
            <div
              key={label}
              className={`bg-[#161b22] border rounded-lg p-3 text-center ${
                highlight ? 'border-[#9EE637]/30' : 'border-[#30363d]'
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${highlight ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
                {value}
              </div>
              <div className="text-xs text-[#768390] mt-0.5">{label}</div>
              {live > 0 && (
                <div className="text-[10px] font-semibold text-[#9EE637] mt-1 animate-pulse">+{live} en vivo</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preguntas */}
      {qPreds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[#e6edf3]">Preguntas</h2>
            <span className="text-xs text-[#768390]">+7 pts por acierto</span>
          </div>
          <div className="space-y-2">
            {qPreds.map((q) => {
              const officialAns = officialAnswers.get(q.pregunta_key as PreguntaKey)
              const isCorrect = officialAns != null && q.respuesta != null
                ? answersMatch(q.respuesta, officialAns as string | number)
                : officialAns != null ? false : null
              return (
                <div key={q.pregunta_key} className="flex items-center gap-3 py-2.5 px-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#768390] mb-0.5">{QUESTION_LABELS[q.pregunta_key]}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#e6edf3]">{q.respuesta ?? '—'}</span>
                      {officialAns != null && (
                        <span className="text-xs text-[#768390]">
                          · Oficial: <span className="text-[#e6edf3]">{String(officialAns)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isCorrect === true && (
                      <span className="text-xs font-bold text-[#9EE637]">+7</span>
                    )}
                    {isCorrect === false && (
                      <span className="text-xs text-[#768390]">✗</span>
                    )}
                    {isCorrect === null && (
                      <span className="text-xs text-[#444d56]">—</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Puestos finales */}
      {semisPreds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[#e6edf3]">Puestos finales</h2>
            {hasSemisOfficial && (
              <span className="text-sm font-bold text-[#9EE637]">+{totalSemisPts} pts</span>
            )}
          </div>
          <div className="space-y-1.5">
            {semisScorePerPick
              .sort((a, b) => (PUESTO_ORDER[a.puesto] ?? 9) - (PUESTO_ORDER[b.puesto] ?? 9))
              .map((p) => (
                <div
                  key={p.puesto}
                  className={`flex items-center gap-3 py-2.5 px-3 rounded-lg border ${
                    p.pts > 0 ? 'bg-[#9EE637]/5 border-[#9EE637]/20' : 'bg-[#161b22] border-[#30363d]'
                  }`}
                >
                  <span className="text-sm text-[#768390] w-28 shrink-0">{PUESTO_LABELS[p.puesto] ?? p.puesto}</span>
                  <span className="text-sm font-medium text-[#e6edf3] flex-1">{p.teams?.nombre ?? '—'}</span>
                  <span className={`text-sm font-bold tabular-nums shrink-0 ${p.pts > 0 ? 'text-[#9EE637]' : 'text-[#444d56]'}`}>
                    {hasSemisOfficial ? (p.pts > 0 ? `+${p.pts}` : '—') : '?'}
                  </span>
                </div>
              ))}
          </div>
          {!hasSemisOfficial && (
            <p className="text-xs text-[#444d56] mt-2">Puntos disponibles cuando el torneo llegue a semifinales</p>
          )}
        </div>
      )}

      {/* Clasificados por grupo */}
      {qualifyPreds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-[#e6edf3]">Clasificados</h2>
            <span className="inline-flex items-center gap-2">
              {totalQualifyTentative > 0 && (
                <span className="text-xs font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">
                  +{totalQualifyTentative} en vivo
                </span>
              )}
              {hasQualifyOfficial && (
                <span className="text-sm font-bold text-[#9EE637]">+{totalQualifyPts} pts</span>
              )}
            </span>
          </div>
          <p className="text-xs text-[#768390] mb-1">
            +4 por equipo clasificado · +4 adicional si acierta la posición · +4 por mejor tercero
          </p>
          {provisionalQualify.liveGroups.size > 0 && (
            <p className="text-xs text-[#768390] mb-3 flex items-center gap-1.5">
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#f85149]" />
              <span className="text-[#9EE637] font-semibold">En verde</span> = tentativo provisional según el marcador en vivo (se fija al cerrar el grupo)
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {qualifyGrupos.map((grupo) => {
              const picks = (qualifyByGrupo.get(grupo) ?? []).sort((a, b) => a.posicion - b.posicion)
              const grupoPts = picks.reduce((s, p) => s + p.pts, 0)
              const grupoTent = picks.reduce((s, p) => s + p.tentativePts, 0)
              const isLiveGroup = picks.some((p) => p.isLiveGroup)
              return (
                <div key={grupo} className={`bg-[#161b22] border rounded-lg p-3 ${isLiveGroup ? 'border-[#9EE637]/30' : 'border-[#30363d]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#768390]">Grupo {grupo}</span>
                    {grupoPts + grupoTent > 0 && (
                      grupoTent > 0 ? (
                        <span className="text-[10px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">+{grupoPts + grupoTent} en vivo</span>
                      ) : (
                        <span className="text-xs font-bold text-[#9EE637]">+{grupoPts}</span>
                      )
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {picks.map((pick) => {
                      const scoring = pick.pts > 0 || pick.tentativePts > 0
                      return (
                        <div key={pick.posicion} className="flex items-center gap-2">
                          <span className="text-xs text-[#768390] w-8 shrink-0">{POSICION_LABELS[pick.posicion]}</span>
                          <span className={`text-sm flex-1 ${scoring ? 'text-[#e6edf3]' : 'text-[#768390]'}`}>
                            {pick.teams?.nombre ?? '—'}
                          </span>
                          <span className={`text-xs font-mono shrink-0 font-bold ${scoring ? 'text-[#9EE637]' : 'text-[#444d56]'}`}>
                            {pick.pts > 0
                              ? `+${pick.pts}`
                              : pick.tentativePts > 0
                                ? `+${pick.tentativePts}`
                                : (hasQualifyOfficial || pick.isLiveGroup) ? '—' : '?'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {!hasQualifyOfficial && provisionalQualify.liveGroups.size === 0 && (
            <p className="text-xs text-[#444d56] mt-2">Puntos disponibles cuando se carguen los clasificados oficiales</p>
          )}
        </div>
      )}

      {/* Partidos de grupos — colapsables por grupo */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">Partidos de grupos</h2>
        <div className="space-y-1.5">
          {sortedGrupos.map((grupo) => {
            const preds = predsByGrupo.get(grupo) ?? []
            const finishedPreds = preds.filter(
              (p) => p.matches?.estado === 'finished' && p.matches?.goles_local !== null,
            )
            const aciertos = finishedPreds.filter((p) => {
              const s = scoreGroupMatch(
                { predLocal: p.pred_local, predVisitante: p.pred_visitante },
                { golesLocal: p.matches!.goles_local!, golesVisitante: p.matches!.goles_visitante! },
              )
              return s.total > 0
            }).length
            const ptosGrupo = finishedPreds.reduce((sum, p) => {
              return sum + scoreGroupMatch(
                { predLocal: p.pred_local, predVisitante: p.pred_visitante },
                { golesLocal: p.matches!.goles_local!, golesVisitante: p.matches!.goles_visitante! },
              ).total
            }, 0)

            return (
              <details key={grupo} className="group">
                <summary className="flex items-center gap-3 py-2.5 px-3 bg-[#161b22] border border-[#30363d] rounded-lg cursor-pointer hover:border-[#9EE637]/30 transition-colors select-none list-none">
                  <span className="text-sm font-medium text-[#e6edf3]">Grupo {grupo}</span>
                  <span className="text-xs text-[#768390] ml-auto">
                    {finishedPreds.length > 0
                      ? `${aciertos}/${finishedPreds.length} aciertos`
                      : `${preds.length} partidos`}
                  </span>
                  {ptosGrupo > 0 && (
                    <span className="text-xs font-bold text-[#9EE637]">+{ptosGrupo}</span>
                  )}
                  <span className="text-xs text-[#768390]">▸</span>
                </summary>
                <div className="mt-1 ml-2 space-y-0.5">
                  {preds.map((pred, idx) => {
                    const m = pred.matches
                    if (!m) return null
                    const finished = m.estado === 'finished' && m.goles_local !== null
                    const live = m.estado === 'live'
                    let score = { signo: 0, exacto: 0, total: 0 }
                    if (finished) {
                      score = scoreGroupMatch(
                        { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
                        { golesLocal: m.goles_local!, golesVisitante: m.goles_visitante! },
                      )
                    }

                    let status = '—'
                    let statusColor = 'text-[#444d56]'
                    let rowBg = ''
                    if (finished) {
                      if (score.total === 5) {
                        status = '+5 ✓✓'; statusColor = 'text-[#58a6ff]'; rowBg = 'bg-[#58a6ff]/5'
                      } else if (score.total === 2) {
                        status = '+2 ✓'; statusColor = 'text-[#9EE637]'; rowBg = 'bg-[#9EE637]/5'
                      } else {
                        status = '✗'; statusColor = 'text-[#f85149]'; rowBg = 'bg-[#f85149]/5'
                      }
                    } else if (live) {
                      status = '🔴'; statusColor = 'text-[#f85149]'
                    }

                    return (
                      <Link key={m.id ?? idx} href={`/match/${m.id}?p=${id}`}>
                        <div className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:brightness-110 transition-all text-sm ${rowBg}`}>
                          <span className="flex-1 text-[#e6edf3] truncate min-w-0">
                            {m.equipo_local?.nombre}{' '}
                            <span className="text-[#9EE637] font-mono">
                              {pred.pred_local}–{pred.pred_visitante}
                            </span>{' '}
                            {m.equipo_visitante?.nombre}
                          </span>
                          {(finished || live) && (
                            <span className="text-xs text-[#768390] shrink-0 font-mono">
                              {m.goles_local}–{m.goles_visitante}
                            </span>
                          )}
                          <span className={`text-xs font-mono shrink-0 w-14 text-right font-bold ${statusColor}`}>
                            {status}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </details>
            )
          })}
        </div>
      </div>
          </div>
        }
      />
    </div>
  )
}
