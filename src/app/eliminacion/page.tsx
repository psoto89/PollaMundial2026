import { createClient } from '@/lib/supabase/server'
import LeaderboardTable from '@/components/leaderboard/LeaderboardTable'
import TeamFlag from '@/components/ui/TeamFlag'
import { loadLeaderboardData } from '@/lib/leaderboardData'
import { getBracketMemberIds } from '@/lib/pollaMembers'
import { ROUND_LABELS, type RoundKey } from '@/config/bracket2026'
import Link from 'next/link'

export const revalidate = 30

interface ElimRow {
  id: string
  fase: string
  goles_local: number | null
  goles_visitante: number | null
  estado: string
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

export default async function EliminacionPage() {
  const supabase = await createClient()
  const { scores, liveMatches, livePreds, groupMatches, teams, qualifyPreds } = await loadLeaderboardData()
  // Solo los que entraron por invitación a la Polla 2 (tienen picks de bracket)
  const memberIds = await getBracketMemberIds()

  const { data: elimRaw } = await supabase
    .from('matches')
    .select(`
      id, fase, goles_local, goles_visitante, estado,
      equipo_local:teams!equipo_local_id(nombre),
      equipo_visitante:teams!equipo_visitante_id(nombre)
    `)
    .neq('fase', 'grupos')
    .in('estado', ['finished', 'live'])
    .order('kickoff_at', { ascending: false })
    .limit(20)

  const elim = (elimRaw ?? []) as unknown as ElimRow[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">🏆 Polla 2 · Cuadro Eliminatorio</h1>
          <p className="text-sm text-[#768390] mt-1">Marcador 90′ + quién avanza · bonos de cuadro · de 16avos a la final</p>
        </div>
        <Link href="/" className="text-xs text-[#768390] hover:text-[#9EE637]">← Inicio</Link>
      </div>

      <LeaderboardTable
        scope="eliminacion"
        initialScores={scores as Parameters<typeof LeaderboardTable>[0]['initialScores']}
        initialLiveMatches={liveMatches}
        initialLivePreds={livePreds}
        groupMatches={groupMatches}
        teams={teams}
        qualifyPreds={qualifyPreds}
        memberIds={memberIds}
      />

      <Link
        href="/polla/eliminacion-2026"
        className="block text-center bg-[#9EE637] rounded-xl p-4 hover:opacity-90 transition-opacity"
      >
        <span className="text-sm font-bold text-[#0d1117]">🎯 Únete con tu correo y arma tu cuadro →</span>
      </Link>
      <p className="text-center text-xs text-[#768390] -mt-3">
        Si no tienes cuenta, te pedimos tu correo y te llega un enlace mágico para entrar.
      </p>

      {elim.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-[#e6edf3] mb-3">Partidos de eliminación</h2>
          <div className="divide-y divide-[#21262d] bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
            {elim.map((m) => (
              <Link key={m.id} href={`/match/${m.id}`}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#1c2128] transition-colors">
                  <span className="text-[10px] text-[#768390] w-12 shrink-0 uppercase">
                    {ROUND_LABELS[m.fase as RoundKey] ?? m.fase}
                  </span>
                  <span className="flex-1 flex items-center gap-2 justify-end min-w-0">
                    <span className="text-sm text-[#e6edf3] truncate">{m.equipo_local?.nombre ?? '—'}</span>
                    <TeamFlag nombre={m.equipo_local?.nombre} size={16} />
                  </span>
                  <span className="text-sm font-bold tabular-nums text-[#9EE637] shrink-0 w-12 text-center">
                    {m.estado === 'live'
                      ? `🔴 ${m.goles_local ?? '–'}–${m.goles_visitante ?? '–'}`
                      : `${m.goles_local ?? '–'} – ${m.goles_visitante ?? '–'}`}
                  </span>
                  <span className="flex-1 flex items-center gap-2 min-w-0">
                    <TeamFlag nombre={m.equipo_visitante?.nombre} size={16} />
                    <span className="text-sm text-[#e6edf3] truncate">{m.equipo_visitante?.nombre ?? '—'}</span>
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
