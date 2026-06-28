import { createClient } from '@/lib/supabase/server'

/**
 * Carga los datos compartidos por las tablas de posiciones (general / grupos /
 * eliminación): puntajes, partidos en vivo + sus pronósticos, y los insumos para
 * los clasificados tentativos en vivo (tabla provisional de grupos).
 *
 * Devuelve objetos ya con la forma que esperan las props de <LeaderboardTable/>.
 */
export async function loadLeaderboardData() {
  const supabase = await createClient()

  const [
    { data: scores },
    { data: liveMatchesRaw },
    { data: groupMatchesRaw },
    { data: teamsRaw },
    { data: qualifyPredsRaw },
  ] = await Promise.all([
    supabase
      .from('scores_cache')
      .select('*, participants(id, nombre, sheet_alias, avatar_url)')
      .order('total', { ascending: false })
      .order('total_grupos', { ascending: false }),
    supabase
      .from('matches')
      .select('id, fase, goles_local, goles_visitante')
      .eq('estado', 'live'),
    supabase
      .from('matches')
      .select('id, grupo, equipo_local_id, equipo_visitante_id, goles_local, goles_visitante, estado')
      .eq('fase', 'grupos'),
    supabase.from('teams').select('id, nombre, grupo'),
    supabase
      .from('predictions_qualify')
      .select('participant_id, grupo, posicion, teams(nombre)'),
  ])

  const liveMatches = (liveMatchesRaw ?? []) as {
    id: string; fase: string | null; goles_local: number | null; goles_visitante: number | null
  }[]

  // Pronósticos de los partidos en vivo (para puntos tentativos)
  const liveIds = liveMatches.map((m) => m.id)
  const { data: livePredsRaw } = liveIds.length > 0
    ? await supabase
        .from('predictions_group')
        .select('participant_id, match_id, pred_local, pred_visitante')
        .in('match_id', liveIds)
    : { data: [] }

  const livePreds = (livePredsRaw ?? []) as {
    participant_id: string; match_id: string; pred_local: number; pred_visitante: number
  }[]

  const groupMatches = ((groupMatchesRaw ?? []) as {
    id: string; grupo: string | null; equipo_local_id: string; equipo_visitante_id: string
    goles_local: number | null; goles_visitante: number | null; estado: string
  }[])
    .filter((m) => m.grupo)
    .map((m) => ({
      id: m.id,
      grupo: m.grupo as string,
      equipoLocalId: m.equipo_local_id,
      equipoVisitanteId: m.equipo_visitante_id,
      golesLocal: m.goles_local,
      golesVisitante: m.goles_visitante,
      estado: m.estado,
    }))

  const teams = ((teamsRaw ?? []) as { id: string; nombre: string; grupo: string }[]).map((t) => ({
    teamId: t.id,
    teamNombre: t.nombre,
    grupo: t.grupo,
  }))

  const qualifyPreds = ((qualifyPredsRaw ?? []) as unknown as {
    participant_id: string; grupo: string; posicion: number; teams: { nombre: string } | null
  }[]).map((p) => ({
    participant_id: p.participant_id,
    grupo: p.grupo,
    posicion: p.posicion,
    teamNombre: p.teams?.nombre ?? '',
  }))

  return { scores: scores ?? [], liveMatches, livePreds, groupMatches, teams, qualifyPreds }
}
