import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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

  const participantId = (account as unknown as { participant_id: string }).participant_id
  const participantNombre =
    (account as unknown as { participants: { nombre: string } | null }).participants?.nombre ?? 'Participante'

  // Config de deadline
  const { data: cfg } = await supabase.from('app_config').select('deadline_minutes').single()
  const deadlineMinutes = cfg?.deadline_minutes ?? 60

  // Mi puntaje + posición en la tabla
  const { data: allScores } = await supabase
    .from('scores_cache')
    .select('participant_id, total, total_grupos, total_eliminacion, total_clasificados, total_semis, total_preguntas')
    .order('total', { ascending: false })

  type ScoreRow = {
    participant_id: string; total: number; total_grupos: number; total_eliminacion: number
    total_clasificados: number; total_semis: number; total_preguntas: number
  }
  const scoresList = (allScores ?? []) as ScoreRow[]
  const myRankIdx = scoresList.findIndex((s) => s.participant_id === participantId)
  const myScore = myRankIdx >= 0 ? scoresList[myRankIdx] : null
  const posicion = myRankIdx >= 0 ? myRankIdx + 1 : null
  const totalParticipantes = scoresList.length

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

  const stats: { label: string; value: number }[] = [
    { label: 'Grupos', value: myScore?.total_grupos ?? 0 },
    { label: 'Eliminación', value: myScore?.total_eliminacion ?? 0 },
    { label: 'Clasificados', value: myScore?.total_clasificados ?? 0 },
    { label: 'Semis', value: myScore?.total_semis ?? 0 },
    { label: 'Preguntas', value: myScore?.total_preguntas ?? 0 },
  ]

  return (
    <div className="space-y-6">
      {/* Header: hola + posición + puntos */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
        <p className="text-sm text-[#768390]">Hola,</p>
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">{participantNombre}</h1>
        <div className="flex items-center gap-4 mt-3">
          <div>
            <div className="text-3xl font-black text-[#9EE637] tabular-nums">{myScore?.total ?? 0}</div>
            <div className="text-xs text-[#768390]">puntos</div>
          </div>
          {posicion !== null && (
            <div className="border-l border-[#30363d] pl-4">
              <div className="text-3xl font-black text-[#e6edf3] tabular-nums">#{posicion}</div>
              <div className="text-xs text-[#768390]">de {totalParticipantes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Desglose por sección */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-[#e6edf3] tabular-nums">{value}</div>
            <div className="text-[10px] text-[#768390] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Pronósticos de eliminación (self-service) */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-1">Eliminación</h2>
        <p className="text-xs text-[#768390] mb-3">
          Marcador por partido · cierra {deadlineMinutes} min antes de cada uno
        </p>
        {matches.length === 0 ? (
          <div className="text-center py-12 text-[#768390] bg-[#161b22] border border-[#30363d] rounded-xl">
            <p className="text-4xl mb-3">⚽</p>
            <p className="text-base font-medium text-[#e6edf3]">Aún no hay partidos de eliminación</p>
            <p className="text-sm mt-1">Aparecerán cuando se definan los cruces. Te avisamos.</p>
          </div>
        ) : (
          <MisPronosticosForm matches={matches} deadlineMinutes={deadlineMinutes} />
        )}
      </div>

      {/* Acceso al desglose completo (partido por partido) */}
      <Link
        href={`/participant/${participantId}`}
        className="block text-center bg-[#161b22] border border-[#30363d] rounded-xl p-4 hover:border-[#9EE637]/40 transition-colors"
      >
        <span className="text-sm font-medium text-[#9EE637]">
          Ver mi desglose completo (partido por partido) →
        </span>
      </Link>
    </div>
  )
}
