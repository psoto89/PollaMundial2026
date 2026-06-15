import { createClient } from '@/lib/supabase/server'
import { scoreGroupMatch } from '@/lib/scoring'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const revalidate = 60

interface Props {
  params: Promise<{ id: string }>
}

interface MatchRow {
  id: string
  grupo: string | null
  match_index: number
  goles_local: number | null
  goles_visitante: number | null
  estado: string
  minuto: number | null
  kickoff_at: string | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

interface PredRow {
  participant_id: string
  pred_local: number
  pred_visitante: number
  participants: { nombre: string } | null
}

const estadoLabel: Record<string, string> = {
  scheduled: 'Programado',
  live: '🔴 En vivo',
  finished: 'Finalizado',
}

export default async function MatchPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: matchRaw } = await supabase
    .from('matches')
    .select(`
      id, grupo, match_index, goles_local, goles_visitante, estado, minuto, kickoff_at,
      equipo_local:teams!equipo_local_id(nombre),
      equipo_visitante:teams!equipo_visitante_id(nombre)
    `)
    .eq('id', id)
    .single()

  if (!matchRaw) notFound()
  const match = matchRaw as unknown as MatchRow

  const { data: predsRaw } = await supabase
    .from('predictions_group')
    .select('participant_id, pred_local, pred_visitante, participants(nombre)')
    .eq('match_id', id)

  const preds = (predsRaw ?? []) as unknown as PredRow[]
  const finished = match.estado === 'finished' && match.goles_local !== null
  const isLive = match.estado === 'live'

  const predsWithScores = preds.map((p) => {
    const score = (finished || isLive)
      ? scoreGroupMatch(
          { predLocal: p.pred_local, predVisitante: p.pred_visitante },
          {
            golesLocal: match.goles_local ?? 0,
            golesVisitante: match.goles_visitante ?? 0,
          },
        )
      : null
    return { ...p, score }
  }).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))

  const totalAcertaron = predsWithScores.filter((p) => (p.score?.total ?? 0) >= 2).length
  const totalExactos = predsWithScores.filter((p) => (p.score?.exacto ?? 0) > 0).length

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
      </div>

      {/* Marcador */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
        <div className="flex items-center justify-between mb-3 text-xs text-[#768390]">
          <span>Grupo {match.grupo}</span>
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
                Resultado final
              </span>
            )}
          </div>
          <span className="text-lg font-bold text-[#e6edf3] flex-1 leading-tight">
            {match.equipo_visitante?.nombre ?? '—'}
          </span>
        </div>

        {/* Resumen de aciertos */}
        {finished && predsWithScores.length > 0 && (
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#21262d] text-xs text-[#768390]">
            <span>
              <span className="font-semibold text-[#9EE637]">{totalAcertaron}</span>/{predsWithScores.length} acertaron el signo
            </span>
            {totalExactos > 0 && (
              <span>
                <span className="font-semibold text-[#58a6ff]">{totalExactos}</span> marcador exacto
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pronósticos con desglose */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">
          Pronósticos ({predsWithScores.length})
        </h2>
        <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
          {predsWithScores.map((p) => {
            const pts = p.score?.total ?? null
            const bgClass = pts === 5 ? 'bg-[#58a6ff]/5' : pts === 2 ? 'bg-[#9EE637]/5' : ''
            return (
              <div key={p.participant_id} className={`flex items-center gap-3 px-4 py-3 ${bgClass}`}>
                {/* Nombre — clickable */}
                <Link
                  href={`/participant/${p.participant_id}`}
                  className="flex-1 text-sm font-medium text-[#e6edf3] hover:text-[#9EE637] transition-colors truncate min-w-0"
                >
                  {p.participants?.nombre ?? p.participant_id}
                </Link>

                {/* Pronóstico */}
                <span className="text-sm font-mono text-[#768390] shrink-0">
                  {p.pred_local}–{p.pred_visitante}
                </span>

                {/* Desglose de puntos */}
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
                      pts === 5 ? 'text-[#58a6ff]' :
                      pts === 2 ? 'text-[#9EE637]' :
                      'text-[#768390]'
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
            <div className="px-4 py-8 text-center text-sm text-[#768390]">
              Sin pronósticos registrados
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
