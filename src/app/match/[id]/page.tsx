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

  const predsWithScores = preds.map((p) => {
    const score = finished
      ? scoreGroupMatch(
          { predLocal: p.pred_local, predVisitante: p.pred_visitante },
          { golesLocal: match.goles_local!, golesVisitante: match.goles_visitante! },
        )
      : null
    return { ...p, score }
  }).sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))

  const estadoLabel: Record<string, string> = {
    scheduled: 'Programado',
    live: '🔴 En vivo',
    finished: 'Finalizado',
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
      </div>

      {/* Marcador */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
        <div className="flex items-center justify-between mb-2 text-xs text-[#768390]">
          <span>Grupo {match.grupo}</span>
          <span className={match.estado === 'live' ? 'text-[#f85149]' : ''}>
            {estadoLabel[match.estado] ?? match.estado}
            {match.estado === 'live' && match.minuto ? ` · ${match.minuto}'` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 mt-4">
          <span className="text-lg font-bold text-[#e6edf3] flex-1 text-right">
            {match.equipo_local?.nombre ?? '—'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_local ?? '–'}
            </span>
            <span className="text-2xl text-[#768390]">–</span>
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_visitante ?? '–'}
            </span>
          </div>
          <span className="text-lg font-bold text-[#e6edf3] flex-1">
            {match.equipo_visitante?.nombre ?? '—'}
          </span>
        </div>
      </div>

      {/* Pronósticos */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">
          Pronósticos ({predsWithScores.length})
        </h2>
        <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
          {predsWithScores.map((p) => (
            <div key={p.participant_id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm font-medium text-[#e6edf3]">
                {p.participants?.nombre ?? p.participant_id}
              </span>
              <span className="text-sm font-mono text-[#768390]">
                {p.pred_local} – {p.pred_visitante}
              </span>
              {p.score !== null && (
                <span className={`text-sm font-bold tabular-nums w-12 text-right ${
                  p.score.total === 5 ? 'text-[#58a6ff]' :
                  p.score.total === 2 ? 'text-[#9EE637]' :
                  'text-[#768390]'
                }`}>
                  {p.score.total > 0 ? `+${p.score.total}` : '—'}
                </span>
              )}
            </div>
          ))}
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
