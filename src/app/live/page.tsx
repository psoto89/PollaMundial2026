import { createClient } from '@/lib/supabase/server'
import LiveView from '@/components/live/LiveView'
import { syncBdlToSupabase } from '@/lib/bdlPoller'

export const revalidate = 0

export default async function LivePage() {
  // Pull desde BDL antes de renderizar — actualiza marcadores en Supabase.
  // Si no hay API key configurada o falla, la página sigue funcionando con datos actuales.
  if (process.env.BALLDONTLIE_API_KEY) {
    try {
      await syncBdlToSupabase('live')
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

  // Supabase devuelve joins como array sin tipos generados; castear explícitamente
  type LiveMatchRow = {
    id: string; grupo: string | null; match_index: number
    goles_local: number | null; goles_visitante: number | null
    minuto: number | null; estado: string
    equipo_local: { id: string; nombre: string } | null
    equipo_visitante: { id: string; nombre: string } | null
  }
  const liveMatches = (liveMatchesRaw ?? []) as unknown as LiveMatchRow[]
  const liveMatchIds = liveMatches.map((m) => m.id)

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
    />
  )
}
