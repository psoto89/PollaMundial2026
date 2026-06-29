import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import InteractiveBracket, {
  type TeamRef, type RealSlot, type MyPick,
} from './InteractiveBracket'

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
        <h1 className="text-xl font-bold text-[#e6edf3]">Cuenta creada — falta vincular</h1>
        <p className="text-sm text-[#768390] mt-2">
          Tu cuenta ya existe, pero aún no está asociada a tu participante de la polla.
          El admin la vinculará pronto y podrás cargar tus pronósticos.
        </p>
      </div>
    )
  }

  const participantId = (account as unknown as { participant_id: string }).participant_id
  const participantNombre =
    (account as unknown as { participants: { nombre: string } | null }).participants?.nombre ?? 'Participante'

  // Config: deadline + rondas habilitadas + activación de la polla
  const { data: cfg } = await supabase
    .from('app_config')
    .select('deadline_minutes, open_rounds, bracket_activated_at')
    .single()
  const deadlineMinutes = cfg?.deadline_minutes ?? 60
  const openRounds = (cfg?.open_rounds as string[] | null) ?? []
  const bracketActivatedAt = (cfg?.bracket_activated_at as string | null) ?? null

  // Mi puntaje + posición en la tabla de la Polla 2 (eliminación)
  const { data: allScores } = await supabase
    .from('scores_cache')
    .select('participant_id, total, total_grupos, total_eliminacion, total_bono_octavos, total_bono_cuartos, total_bono_semis, total_bono_finales')
    .order('total_eliminacion', { ascending: false })
    .order('total_grupos', { ascending: false })

  type ScoreRow = {
    participant_id: string; total: number; total_grupos: number; total_eliminacion: number
    total_bono_octavos: number; total_bono_cuartos: number; total_bono_semis: number; total_bono_finales: number
  }
  const scoresList = (allScores ?? []) as ScoreRow[]
  const myRankIdx = scoresList.findIndex((s) => s.participant_id === participantId)
  const myScore = myRankIdx >= 0 ? scoresList[myRankIdx] : null
  const posicion = myRankIdx >= 0 ? myRankIdx + 1 : null
  const totalParticipantes = scoresList.length

  // Equipos (para resolver el cuadro por id)
  const { data: teamsRaw } = await supabase.from('teams').select('id, nombre').order('nombre')
  const teams = (teamsRaw ?? []) as TeamRef[]

  // Partidos reales de eliminación, indexados por slot
  const { data: matchesRaw } = await supabase
    .from('matches')
    .select('id, bracket_slot, kickoff_at, estado, goles_local, goles_visitante, advancer_team_id, equipo_local_id, equipo_visitante_id')
    .neq('fase', 'grupos')

  type MatchRow = {
    id: string; bracket_slot: string | null; kickoff_at: string | null; estado: string
    goles_local: number | null; goles_visitante: number | null; advancer_team_id: string | null
    equipo_local_id: string | null; equipo_visitante_id: string | null
  }
  const realSlots: RealSlot[] = ((matchesRaw ?? []) as MatchRow[])
    .filter((m) => !!m.bracket_slot)
    .map((m) => ({
      slot: m.bracket_slot!,
      localId: m.equipo_local_id,
      visitanteId: m.equipo_visitante_id,
      kickoffAt: m.kickoff_at,
      estado: m.estado,
      golesLocal: m.goles_local,
      golesVisitante: m.goles_visitante,
      advancerTeamId: m.advancer_team_id,
    }))

  // Mis picks del cuadro (RLS deja ver los propios)
  const { data: picksRaw } = await supabase
    .from('predictions_bracket')
    .select('slot, advancer_team_id, pred_local, pred_visitante')
    .eq('participant_id', participantId)
  const myPicks = ((picksRaw ?? []) as {
    slot: string; advancer_team_id: string | null; pred_local: number | null; pred_visitante: number | null
  }[]).map((p): MyPick => ({
    slot: p.slot,
    advancerTeamId: p.advancer_team_id,
    predLocal: p.pred_local,
    predVisitante: p.pred_visitante,
  }))

  // Conteo público de picks por slot (sin exponer marcadores)
  const { data: countsRaw } = await supabase.rpc('bracket_prediction_counts')
  const counts = (countsRaw ?? []) as { slot: string; n: number }[]

  const bonos =
    (myScore?.total_bono_octavos ?? 0) + (myScore?.total_bono_cuartos ?? 0) +
    (myScore?.total_bono_semis ?? 0) + (myScore?.total_bono_finales ?? 0)
  const partidos = (myScore?.total_eliminacion ?? 0) - bonos

  const stats: { label: string; value: number }[] = [
    { label: 'Partidos', value: partidos },
    { label: 'Bono 8vos', value: myScore?.total_bono_octavos ?? 0 },
    { label: 'Bono Cuartos', value: myScore?.total_bono_cuartos ?? 0 },
    { label: 'Bono Semis', value: myScore?.total_bono_semis ?? 0 },
    { label: 'Bono Finales', value: myScore?.total_bono_finales ?? 0 },
  ]

  return (
    <div className="space-y-6">
      {/* Header: hola + posición + puntos de eliminación */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
        <p className="text-sm text-[#768390]">Hola,</p>
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">{participantNombre}</h1>
        <div className="flex items-center gap-4 mt-3">
          <div>
            <div className="text-3xl font-black text-[#9EE637] tabular-nums">{myScore?.total_eliminacion ?? 0}</div>
            <div className="text-xs text-[#768390]">puntos eliminación</div>
          </div>
          {posicion !== null && (
            <div className="border-l border-[#30363d] pl-4">
              <div className="text-3xl font-black text-[#e6edf3] tabular-nums">#{posicion}</div>
              <div className="text-xs text-[#768390]">de {totalParticipantes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Desglose de la Polla 2 */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map(({ label, value }) => (
          <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-[#e6edf3] tabular-nums">{value}</div>
            <div className="text-[10px] text-[#768390] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Cuadro interactivo */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-1">Tu cuadro</h2>
        <p className="text-xs text-[#768390] mb-3">
          Toca el equipo que avanza en cada partido — alimenta automáticamente la siguiente ronda.
          Marcador de 90&apos;. Editable hasta {deadlineMinutes} min antes de cada partido.
        </p>
        <InteractiveBracket
          teams={teams}
          realSlots={realSlots}
          myPicks={myPicks}
          counts={counts}
          openRounds={openRounds}
          deadlineMinutes={deadlineMinutes}
          bracketActivatedAt={bracketActivatedAt}
          totalParticipantes={totalParticipantes}
        />
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
