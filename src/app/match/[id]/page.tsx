import { createClient } from '@/lib/supabase/server'
import { scoreGroupMatch, scoreKnockoutMatch } from '@/lib/scoring'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const revalidate = 60

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ p?: string }>
}

interface MatchRow {
  id: string
  fase: string
  grupo: string | null
  match_index: number
  goles_local: number | null
  goles_visitante: number | null
  estado: string
  minuto: number | null
  kickoff_at: string | null
  bracket_slot: string | null
  advancer_team_id: string | null
  equipo_local: { id: string; nombre: string } | null
  equipo_visitante: { id: string; nombre: string } | null
}

interface PredRow {
  participant_id: string
  pred_local: number
  pred_visitante: number
  participants: { nombre: string } | null
}

interface BracketPredRow {
  participant_id: string
  pred_local: number | null
  pred_visitante: number | null
  advancer_team_id: string | null
  participants: { nombre: string } | null
  advancer: { nombre: string } | null
}

const estadoLabel: Record<string, string> = {
  scheduled: 'Programado',
  live: '🔴 En vivo',
  finished: 'Finalizado',
}

export default async function MatchPage({ params, searchParams }: Props) {
  const { id } = await params
  const { p: highlightId } = await searchParams
  const supabase = await createClient()

  const { data: matchRaw } = await supabase
    .from('matches')
    .select(`
      id, fase, grupo, match_index, goles_local, goles_visitante, estado, minuto, kickoff_at,
      bracket_slot, advancer_team_id,
      equipo_local:teams!equipo_local_id(id, nombre),
      equipo_visitante:teams!equipo_visitante_id(id, nombre)
    `)
    .eq('id', id)
    .single()

  if (!matchRaw) notFound()
  const match = matchRaw as unknown as MatchRow

  const isKnockout = match.fase !== 'grupos'
  const finished = match.estado === 'finished' && match.goles_local !== null
  const isLive = match.estado === 'live'

  // Ocultar pronósticos de otros hasta el cierre (kickoff - deadline)
  let predsHidden = false
  if (isKnockout && match.kickoff_at) {
    const { data: cfg } = await supabase.from('app_config').select('deadline_minutes').single()
    const deadlineMin = cfg?.deadline_minutes ?? 60
    const deadlineMs = new Date(match.kickoff_at).getTime() - deadlineMin * 60_000
    predsHidden = Date.now() < deadlineMs
  }

  // Equipo que avanzó oficialmente (para marcar el acierto del "clasificado")
  const advancerNombre =
    match.advancer_team_id === match.equipo_local?.id ? match.equipo_local?.nombre :
    match.advancer_team_id === match.equipo_visitante?.id ? match.equipo_visitante?.nombre :
    null

  // ─── Polla 2 (cuadro): pronósticos por slot, puntaje knockout ──────────────
  if (isKnockout && match.bracket_slot) {
    const { data: predsRaw } = await supabase
      .from('predictions_bracket')
      .select('participant_id, pred_local, pred_visitante, advancer_team_id, participants(nombre), advancer:teams!advancer_team_id(nombre)')
      .eq('slot', match.bracket_slot)

    const preds = (predsRaw ?? []) as unknown as BracketPredRow[]
    const scored = preds.map((p) => {
      const score = (finished || isLive)
        ? scoreKnockoutMatch(
            { predLocal: p.pred_local, predVisitante: p.pred_visitante, advancer: p.advancer_team_id },
            {
              golesLocal: match.goles_local,
              golesVisitante: match.goles_visitante,
              advancer: finished ? match.advancer_team_id : null, // el clasificado solo cuenta al finalizar
            },
          )
        : null
      return { ...p, score }
    }).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))

    const highlighted = highlightId ? scored.find((p) => p.participant_id === highlightId) : undefined
    const ordered = highlighted
      ? [highlighted, ...scored.filter((p) => p.participant_id !== highlightId)]
      : scored
    const highlightedNombre = highlighted?.participants?.nombre ?? null

    return (
      <div className="space-y-6">
        <BackLink />
        <Scoreboard match={match} finished={finished} isLive={isLive} isKnockout={isKnockout} />

        {predsHidden ? (
          <PredsLocked />
        ) : (
          <div>
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-[#e6edf3]">Pronósticos · Cuadro ({ordered.length})</h2>
              {highlightedNombre && (
                <p className="text-xs text-[#9EE637] mt-0.5">Mostrando el pronóstico de {highlightedNombre} arriba</p>
              )}
              {advancerNombre && finished && (
                <p className="text-xs text-[#768390] mt-0.5">Avanzó: <span className="text-[#e6edf3]">{advancerNombre}</span></p>
              )}
            </div>
            <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
              {ordered.map((p) => {
                const pts = p.score?.total ?? null
                const isH = highlightId != null && p.participant_id === highlightId
                const aciertoAdvancer = finished && p.advancer_team_id && p.advancer_team_id === match.advancer_team_id
                const bg = isH ? 'bg-[#9EE637]/10 ring-1 ring-inset ring-[#9EE637]/40' : (pts ?? 0) > 0 ? 'bg-[#9EE637]/5' : ''
                return (
                  <div key={p.participant_id} className={`flex items-center gap-3 px-4 py-3 ${bg}`}>
                    <Link
                      href={`/participant/${p.participant_id}`}
                      className="flex-1 text-sm font-medium text-[#e6edf3] hover:text-[#9EE637] transition-colors truncate min-w-0"
                    >
                      {p.participants?.nombre ?? p.participant_id}
                    </Link>

                    {/* Quién pasa (su pick) */}
                    {p.advancer?.nombre && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                        aciertoAdvancer ? 'bg-[#9EE637]/20 text-[#9EE637]' : 'bg-[#21262d] text-[#768390]'
                      }`}>
                        {aciertoAdvancer ? '✓ ' : ''}pasa {p.advancer.nombre}
                      </span>
                    )}

                    {/* Marcador 90' */}
                    <span className="text-sm font-mono text-[#768390] shrink-0">
                      {p.pred_local ?? '–'}–{p.pred_visitante ?? '–'}
                    </span>

                    {/* Desglose */}
                    {p.score !== null ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.score.marcador > 0 && (
                          <span className="text-[10px] font-semibold bg-[#58a6ff]/15 text-[#58a6ff] px-1.5 py-0.5 rounded">
                            +{p.score.marcador} marcador
                          </span>
                        )}
                        {p.score.clasificado > 0 && (
                          <span className="text-[10px] font-semibold bg-[#9EE637]/15 text-[#9EE637] px-1.5 py-0.5 rounded">
                            +{p.score.clasificado} pasa
                          </span>
                        )}
                        <span className={`text-sm font-bold tabular-nums w-8 text-right ${(pts ?? 0) > 0 ? 'text-[#9EE637]' : 'text-[#768390]'}`}>
                          {pts !== null && pts > 0 ? `+${pts}` : '—'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#768390] shrink-0 w-8 text-right">–</span>
                    )}
                  </div>
                )
              })}
              {ordered.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-[#768390]">Sin pronósticos registrados</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Fase de grupos (Polla 1): pronósticos por match_id ────────────────────
  const { data: predsRaw } = await supabase
    .from('predictions_group')
    .select('participant_id, pred_local, pred_visitante, participants(nombre)')
    .eq('match_id', id)

  const preds = (predsRaw ?? []) as unknown as PredRow[]

  const scored = preds.map((p) => {
    const score = (finished || isLive)
      ? scoreGroupMatch(
          { predLocal: p.pred_local, predVisitante: p.pred_visitante },
          { golesLocal: match.goles_local ?? 0, golesVisitante: match.goles_visitante ?? 0 },
        )
      : null
    return { ...p, score }
  }).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))

  const highlighted = highlightId ? scored.find((p) => p.participant_id === highlightId) : undefined
  const highlightedNombre = highlighted?.participants?.nombre ?? null
  const predsWithScores = highlighted
    ? [highlighted, ...scored.filter((p) => p.participant_id !== highlightId)]
    : scored

  const totalAcertaron = predsWithScores.filter((p) => (p.score?.total ?? 0) >= 2).length
  const totalExactos = predsWithScores.filter((p) => (p.score?.exacto ?? 0) > 0).length

  return (
    <div className="space-y-6">
      <BackLink />
      <Scoreboard match={match} finished={finished} isLive={isLive} isKnockout={isKnockout}>
        {finished && predsWithScores.length > 0 && (
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#21262d] text-xs text-[#768390]">
            <span>
              <span className="font-semibold text-[#9EE637]">{totalAcertaron}</span>/{predsWithScores.length} acertaron el signo
            </span>
            {totalExactos > 0 && (
              <span><span className="font-semibold text-[#58a6ff]">{totalExactos}</span> marcador exacto</span>
            )}
          </div>
        )}
      </Scoreboard>

      {predsHidden ? (
        <PredsLocked />
      ) : (
        <div>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-[#e6edf3]">Pronósticos ({predsWithScores.length})</h2>
            {highlightedNombre && (
              <p className="text-xs text-[#9EE637] mt-0.5">Mostrando el pronóstico de {highlightedNombre} arriba</p>
            )}
          </div>
          <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            {predsWithScores.map((p) => {
              const pts = p.score?.total ?? null
              const isHighlighted = highlightId != null && p.participant_id === highlightId
              const bgClass = isHighlighted
                ? 'bg-[#9EE637]/10 ring-1 ring-inset ring-[#9EE637]/40'
                : pts === 5 ? 'bg-[#58a6ff]/5' : pts === 2 ? 'bg-[#9EE637]/5' : ''
              return (
                <div key={p.participant_id} className={`flex items-center gap-3 px-4 py-3 ${bgClass}`}>
                  <Link
                    href={`/participant/${p.participant_id}`}
                    className="flex-1 text-sm font-medium text-[#e6edf3] hover:text-[#9EE637] transition-colors truncate min-w-0"
                  >
                    {p.participants?.nombre ?? p.participant_id}
                  </Link>
                  <span className="text-sm font-mono text-[#768390] shrink-0">
                    {p.pred_local}–{p.pred_visitante}
                  </span>
                  {p.score !== null ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.score.signo > 0 && (
                        <span className="text-[10px] font-semibold bg-[#9EE637]/15 text-[#9EE637] px-1.5 py-0.5 rounded">
                          +{p.score.signo} signo
                        </span>
                      )}
                      {p.score.exacto > 0 && (
                        <span className="text-[10px] font-semibold bg-[#58a6ff]/15 text-[#58a6ff] px-1.5 py-0.5 rounded">
                          +{p.score.exacto} exacto
                        </span>
                      )}
                      <span className={`text-sm font-bold tabular-nums w-8 text-right ${
                        pts === 5 ? 'text-[#58a6ff]' : pts === 2 ? 'text-[#9EE637]' : 'text-[#768390]'
                      }`}>
                        {pts !== null && pts > 0 ? `+${pts}` : '—'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-[#768390] shrink-0 w-8 text-right">–</span>
                  )}
                </div>
              )
            })}
            {predsWithScores.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[#768390]">Sin pronósticos registrados</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── UI compartida ────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <div>
      <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
        ← Tabla general
      </Link>
    </div>
  )
}

function PredsLocked() {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 text-center">
      <p className="text-3xl mb-3">🔒</p>
      <p className="text-base font-medium text-[#e6edf3]">Pronósticos ocultos hasta el cierre</p>
      <p className="text-sm text-[#768390] mt-1">
        Se revelan cuando cierre el pronóstico de este partido.
      </p>
    </div>
  )
}

function Scoreboard({
  match, finished, isLive, isKnockout, children,
}: {
  match: MatchRow; finished: boolean; isLive: boolean; isKnockout: boolean; children?: React.ReactNode
}) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
      <div className="flex items-center justify-between mb-3 text-xs text-[#768390]">
        <span>{isKnockout ? match.fase : `Grupo ${match.grupo}`}</span>
        <span className={isLive ? 'text-[#f85149] font-semibold' : ''}>
          {estadoLabel[match.estado] ?? match.estado}
          {isLive && match.minuto ? ` · ${match.minuto}'` : ''}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 mt-2">
        <span className="text-lg font-bold text-[#e6edf3] flex-1 text-right leading-tight">
          {match.equipo_local?.nombre ?? '—'}
        </span>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_local ?? '–'}
            </span>
            <span className="text-2xl text-[#768390]">–</span>
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_visitante ?? '–'}
            </span>
          </div>
          {finished && (
            <span className="text-[10px] font-semibold text-[#768390] uppercase tracking-widest">
              {isKnockout ? "Final 90'" : 'Resultado final'}
            </span>
          )}
        </div>
        <span className="text-lg font-bold text-[#e6edf3] flex-1 leading-tight">
          {match.equipo_visitante?.nombre ?? '—'}
        </span>
      </div>

      {children}
    </div>
  )
}
