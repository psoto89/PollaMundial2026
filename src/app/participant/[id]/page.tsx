import { createClient } from '@/lib/supabase/server'
import { scoreGroupMatch, scoreQualify, scoreSemis, answersMatch } from '@/lib/scoring'
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
          id, grupo, goles_local, goles_visitante, estado,
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

  // Proyección de puntos por pick en Clasificados
  const qualifyScorePerPick = qualifyPreds.map((pred) => {
    const teamNombre = pred.teams?.nombre ?? ''
    const result = scoreQualify(
      [{ grupo: pred.grupo, posicion: pred.posicion as 1 | 2 | 3, teamNombre }],
      qualifyOfficial,
    )
    return { ...pred, pts: result.total }
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
  const totalSemisPts = semisScorePerPick.reduce((s, p) => s + p.pts, 0)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
        <h1 className="text-2xl font-bold text-[#e6edf3]">{participant.nombre}</h1>
      </div>

      {/* Resumen de puntos */}
      {scores && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: scores.total as number, highlight: true },
            { label: 'Grupos', value: scores.total_grupos as number },
            { label: 'Clasificados', value: scores.total_clasificados as number },
            { label: 'Semis', value: scores.total_semis as number },
            { label: 'Preguntas', value: scores.total_preguntas as number },
          ].map(({ label, value, highlight }) => (
            <div
              key={label}
              className={`bg-[#161b22] border rounded-lg p-3 text-center ${
                highlight ? 'border-[#9EE637]/30' : 'border-[#30363d]'
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${highlight ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
                {value ?? 0}
              </div>
              <div className="text-xs text-[#768390] mt-0.5">{label}</div>
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
            {hasQualifyOfficial && (
              <span className="text-sm font-bold text-[#9EE637]">+{totalQualifyPts} pts</span>
            )}
          </div>
          <p className="text-xs text-[#768390] mb-3">
            +4 por equipo clasificado · +4 adicional si acierta la posición · +4 por mejor tercero
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {qualifyGrupos.map((grupo) => {
              const picks = (qualifyByGrupo.get(grupo) ?? []).sort((a, b) => a.posicion - b.posicion)
              const grupoPts = picks.reduce((s, p) => s + p.pts, 0)
              return (
                <div key={grupo} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#768390]">Grupo {grupo}</span>
                    {hasQualifyOfficial && grupoPts > 0 && (
                      <span className="text-xs font-bold text-[#9EE637]">+{grupoPts}</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {picks.map((pick) => (
                      <div key={pick.posicion} className="flex items-center gap-2">
                        <span className="text-xs text-[#768390] w-8 shrink-0">{POSICION_LABELS[pick.posicion]}</span>
                        <span className={`text-sm flex-1 ${pick.pts > 0 ? 'text-[#e6edf3]' : 'text-[#768390]'}`}>
                          {pick.teams?.nombre ?? '—'}
                        </span>
                        <span className={`text-xs font-mono shrink-0 ${pick.pts > 0 ? 'text-[#9EE637] font-bold' : 'text-[#444d56]'}`}>
                          {hasQualifyOfficial ? (pick.pts > 0 ? `+${pick.pts}` : '—') : '?'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {!hasQualifyOfficial && (
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
                    let status = '—'
                    let statusColor = 'text-[#768390]'
                    if (finished) {
                      const s = scoreGroupMatch(
                        { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
                        { golesLocal: m.goles_local!, golesVisitante: m.goles_visitante! },
                      )
                      if (s.total === 5) { status = '+5 ✓✓'; statusColor = 'text-[#58a6ff]' }
                      else if (s.total === 2) { status = '+2 ✓'; statusColor = 'text-[#9EE637]' }
                      else { status = '✗'; statusColor = 'text-[#768390]' }
                    }
                    return (
                      <Link key={m.id ?? idx} href={`/match/${m.id}`}>
                        <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-[#1c2128] transition-colors text-sm">
                          <span className="flex-1 text-[#e6edf3] truncate min-w-0">
                            {m.equipo_local?.nombre}{' '}
                            <span className="text-[#9EE637] font-mono">
                              {pred.pred_local}–{pred.pred_visitante}
                            </span>{' '}
                            {m.equipo_visitante?.nombre}
                          </span>
                          {finished && (
                            <span className="text-xs text-[#768390] shrink-0 font-mono">
                              {m.goles_local}–{m.goles_visitante}
                            </span>
                          )}
                          <span className={`text-xs font-mono shrink-0 w-14 text-right ${statusColor}`}>
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
  )
}
