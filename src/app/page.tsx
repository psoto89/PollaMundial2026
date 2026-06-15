import { createClient } from '@/lib/supabase/server'
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable'
import LiveBanner from '@/components/live/LiveBanner'

export const revalidate = 30

interface LiveMatchRow {
  id: string
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

export default async function Home() {
  const supabase = await createClient()

  const { data: scores } = await supabase
    .from('scores_cache')
    .select('*, participants(id, nombre, sheet_alias, avatar_url)')
    .order('total', { ascending: false })

  const { data: liveMatchesRaw } = await supabase
    .from('matches')
    .select(`
      id, goles_local, goles_visitante, minuto,
      equipo_local:teams!equipo_local_id(nombre),
      equipo_visitante:teams!equipo_visitante_id(nombre)
    `)
    .eq('estado', 'live')
    .limit(1)

  const liveMatch = liveMatchesRaw?.[0] as LiveMatchRow | undefined ?? null

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

      <LeaderboardTable initialScores={scores as Parameters<typeof LeaderboardTable>[0]['initialScores'] ?? []} />
    </div>
  )
}
