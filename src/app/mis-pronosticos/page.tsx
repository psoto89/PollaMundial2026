import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MisPronosticosForm, { type KnockoutMatch } from './MisPronosticosForm'

export const revalidate = 0

export default async function MisPronosticosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Cuenta vinculada
  const { data: account } = await supabase
    .from('participant_accounts')
    .select('participant_id, participants(nombre)')
    .eq('auth_user_id', user.id)
    .single()

  if (!account) {
    return (
      <div className="max-w-md mx-auto py-12 text-center">
        <p className="text-3xl mb-3">🔗</p>
        <h1 className="text-xl font-bold text-[#e6edf3]">Cuenta no vinculada</h1>
        <p className="text-sm text-[#768390] mt-2">
          Tu correo aún no está asociado a un participante. Contacta al admin para que te registre.
        </p>
      </div>
    )
  }

  const participantNombre =
    (account as unknown as { participants: { nombre: string } | null }).participants?.nombre ?? 'Participante'

  // Config de deadline
  const { data: cfg } = await supabase.from('app_config').select('deadline_minutes').single()
  const deadlineMinutes = cfg?.deadline_minutes ?? 60

  // Partidos de eliminación (todo lo que no sea grupos), con equipos ya conocidos
  const { data: matchesRaw } = await supabase
    .from('matches')
    .select(`
      id, fase, match_index, kickoff_at, estado, goles_local, goles_visitante,
      equipo_local:teams!equipo_local_id(nombre),
      equipo_visitante:teams!equipo_visitante_id(nombre)
    `)
    .neq('fase', 'grupos')
    .order('kickoff_at', { ascending: true })

  type MatchRow = {
    id: string; fase: string; match_index: number; kickoff_at: string | null; estado: string
    goles_local: number | null; goles_visitante: number | null
    equipo_local: { nombre: string } | null
    equipo_visitante: { nombre: string } | null
  }
  const matchRows = (matchesRaw ?? []) as unknown as MatchRow[]
  const matchIds = matchRows.map((m) => m.id)

  // Mis pronósticos existentes (RLS deja ver los propios)
  const { data: predsRaw } = matchIds.length > 0
    ? await supabase
        .from('predictions_group')
        .select('match_id, pred_local, pred_visitante')
        .in('match_id', matchIds)
    : { data: [] }

  const predByMatch = new Map(
    ((predsRaw ?? []) as { match_id: string; pred_local: number; pred_visitante: number }[])
      .map((p) => [p.match_id, p]),
  )

  const matches: KnockoutMatch[] = matchRows.map((m) => {
    const pred = predByMatch.get(m.id)
    return {
      id: m.id,
      fase: m.fase,
      kickoffAt: m.kickoff_at,
      estado: m.estado,
      localNombre: m.equipo_local?.nombre ?? '—',
      visitanteNombre: m.equipo_visitante?.nombre ?? '—',
      golesLocal: m.goles_local,
      golesVisitante: m.goles_visitante,
      predLocal: pred?.pred_local ?? null,
      predVisitante: pred?.pred_visitante ?? null,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">Mis Pronósticos</h1>
        <p className="text-sm text-[#768390] mt-1">
          {participantNombre} · Eliminación · cierra {deadlineMinutes} min antes de cada partido
        </p>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-16 text-[#768390] bg-[#161b22] border border-[#30363d] rounded-xl">
          <p className="text-4xl mb-3">⚽</p>
          <p className="text-base font-medium text-[#e6edf3]">Aún no hay partidos de eliminación</p>
          <p className="text-sm mt-1">Aparecerán cuando se definan los cruces. Te avisamos.</p>
        </div>
      ) : (
        <MisPronosticosForm matches={matches} deadlineMinutes={deadlineMinutes} />
      )}
    </div>
  )
}
