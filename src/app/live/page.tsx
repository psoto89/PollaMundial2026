import { createClient } from '@/lib/supabase/server'
import LiveView from '@/components/live/LiveView'
import { syncLive } from '@/lib/tsdbPoller'

export const revalidate = 0

export default async function LivePage() {
  // Pull desde TheSportsDB antes de renderizar — actualiza marcadores en Supabase.
  // Si no hay API key o falla, la página sigue con los datos actuales.
  if (process.env.THESPORTSDB_API_KEY) {
    try {
      await syncLive()
    } catch {
      // No bloquear el render si falla el poll
    }
  }

  const supabase = await createClient()

  const { data: liveMatchesRaw } = await supabase
    .from('matches')
    .select(`
      id, grupo, match_index, goles_local, goles_visitante, minuto, estado,
      equipo_local:teams!equipo_local_id(id, nombre),
      equipo_visitante:teams!equipo_visitante_id(id, nombre)
    `)
    .eq('estado', 'live')

  type LiveMatchRow = {
    id: string; grupo: string | null; match_index: number
    goles_local: number | null; goles_visitante: number | null
    minuto: number | null; estado: string
    equipo_local: { id: string; nombre: string } | null
    equipo_visitante: { id: string; nombre: string } | null
  }
  const liveMatches = (liveMatchesRaw ?? []) as unknown as LiveMatchRow[]
  const liveMatchIds = liveMatches.map((m) => m.id)

  // ── Próximos partidos (jornadas que vienen) ─────────────────────────────────
  const { data: upcomingRaw } = await supabase
    .from('matches')
    .select(`
      id, grupo, fase, match_index, kickoff_at, estado,
      equipo_local:teams!equipo_local_id(id, nombre),
      equipo_visitante:teams!equipo_visitante_id(id, nombre)
    `)
    .eq('estado', 'scheduled')
    .not('kickoff_at', 'is', null)
    .gte('kickoff_at', new Date().toISOString())
    .order('kickoff_at', { ascending: true })
    .limit(16)

  type UpcomingMatchRow = {
    id: string; grupo: string | null; fase: string; match_index: number
    kickoff_at: string | null; estado: string
    equipo_local: { id: string; nombre: string } | null
    equipo_visitante: { id: string; nombre: string } | null
  }
  const upcomingMatches = (upcomingRaw ?? []) as unknown as UpcomingMatchRow[]

  type PredRow = {
    participant_id: string; match_id: string
    pred_local: number; pred_visitante: number
    participants: { id: string; nombre: string } | null
  }

  const { data: groupPredsRaw } = liveMatchIds.length > 0
    ? await supabase
        .from('predictions_group')
        .select('participant_id, match_id, pred_local, pred_visitante, participants(id, nombre)')
        .in('match_id', liveMatchIds)
    : { data: [] }

  const groupPreds = (groupPredsRaw ?? []) as unknown as PredRow[]

  const { data: participants } = await supabase
    .from('participants')
    .select('id, nombre')
    .order('nombre')

  return (
    <LiveView
      initialMatches={liveMatches}
      initialPreds={groupPreds}
      participants={(participants ?? []) as { id: string; nombre: string }[]}
      upcomingMatches={upcomingMatches}
    />
  )
}
