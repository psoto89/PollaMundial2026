import { createClient } from '@/lib/supabase/server'
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable'
import LiveBanner from '@/components/live/LiveBanner'
import Link from 'next/link'

export const revalidate = 30

interface LiveMatchRow {
  id: string
  fase: string | null
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

interface MatchRow {
  id: string
  grupo: string | null
  goles_local: number | null
  goles_visitante: number | null
  estado: string
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

export default async function Home() {
  const supabase = await createClient()

  const [
    { data: scores },
    { data: liveMatchesRaw },
    { data: recentMatchesRaw },
  ] = await Promise.all([
    supabase
      .from('scores_cache')
      .select('*, participants(id, nombre, sheet_alias, avatar_url)')
      .order('total', { ascending: false }),
    supabase
      .from('matches')
      .select(`
        id, fase, goles_local, goles_visitante, minuto,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .eq('estado', 'live'),
    supabase
      .from('matches')
      .select(`
        id, grupo, goles_local, goles_visitante, estado,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .in('estado', ['finished', 'live'])
      .order('kickoff_at', { ascending: false })
      .limit(20),
  ])

  const liveMatchesAll = (liveMatchesRaw ?? []) as unknown as LiveMatchRow[]
  const liveMatch = liveMatchesAll[0] ?? null
  const recentMatches = (recentMatchesRaw ?? []) as unknown as MatchRow[]

  // Pronósticos de los partidos en vivo → puntos tentativos en la tabla general
  const liveIds = liveMatchesAll.map((m) => m.id)
  const { data: livePredsRaw } = liveIds.length > 0
    ? await supabase
        .from('predictions_group')
        .select('participant_id, match_id, pred_local, pred_visitante')
        .in('match_id', liveIds)
    : { data: [] }

  const initialLiveMatches = liveMatchesAll.map((m) => ({
    id: m.id,
    fase: m.fase,
    goles_local: m.goles_local,
    goles_visitante: m.goles_visitante,
  }))
  const initialLivePreds = (livePredsRaw ?? []) as {
    participant_id: string; match_id: string; pred_local: number; pred_visitante: number
  }[]

  return (
    <div className="space-y-6">
      {liveMatch && <LiveBanner match={liveMatch} />}

      <div>
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">
          Tabla de posiciones
        </h1>
        <p className="text-sm text-[#768390] mt-1">
          {scores?.length ?? 0} participantes · se actualiza en tiempo real
        </p>
      </div>

      <LeaderboardTable
        initialScores={scores as Parameters<typeof LeaderboardTable>[0]['initialScores'] ?? []}
        initialLiveMatches={initialLiveMatches}
        initialLivePreds={initialLivePreds}
      />

      {recentMatches.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-[#e6edf3] mb-3">Partidos jugados</h2>
          <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            {recentMatches.map((m) => (
              <Link key={m.id} href={`/match/${m.id}`}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#1c2128] transition-colors">
                  <span className="text-xs text-[#768390] w-6 shrink-0">G{m.grupo}</span>
                  <span className="flex-1 text-sm text-[#e6edf3] text-right truncate">
                    {m.equipo_local?.nombre ?? '—'}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-[#9EE637] shrink-0 w-12 text-center">
                    {m.estado === 'live'
                      ? `🔴 ${m.goles_local ?? '–'}–${m.goles_visitante ?? '–'}`
                      : `${m.goles_local ?? '–'} – ${m.goles_visitante ?? '–'}`
                    }
                  </span>
                  <span className="flex-1 text-sm text-[#e6edf3] truncate">
                    {m.equipo_visitante?.nombre ?? '—'}
                  </span>
                  <span className="text-xs text-[#9EE637] shrink-0">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
