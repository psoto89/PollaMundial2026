'use client'

import { Fragment, useEffect, useState, useRef, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { scoreGroupMatch, scoreQualify, type QualifyPred, type QualifyOfficial } from '@/lib/scoring'
import { computeGroupStandings } from '@/lib/standings'

interface ScoreRow {
  participant_id: string
  total: number
  total_grupos: number
  total_eliminacion: number
  total_clasificados: number
  total_semis: number
  total_preguntas: number
  participants: {
    id: string
    nombre: string
    sheet_alias: string
    avatar_url: string | null
  } | null
}

interface LiveMatchLite {
  id: string
  fase: string | null
  goles_local: number | null
  goles_visitante: number | null
}

interface LivePred {
  participant_id: string
  match_id: string
  pred_local: number
  pred_visitante: number
}

interface GroupMatchLite {
  id: string
  grupo: string
  equipoLocalId: string
  equipoVisitanteId: string
  golesLocal: number | null
  golesVisitante: number | null
  estado: string
}

interface TeamLite {
  teamId: string
  teamNombre: string
  grupo: string
}

interface QualifyPredLite {
  participant_id: string
  grupo: string
  posicion: number
  teamNombre: string
}

interface Props {
  initialScores: ScoreRow[]
  initialLiveMatches?: LiveMatchLite[]
  initialLivePreds?: LivePred[]
  groupMatches?: GroupMatchLite[]
  teams?: TeamLite[]
  qualifyPreds?: QualifyPredLite[]
}

export default function LeaderboardTable({
  initialScores,
  initialLiveMatches = [],
  initialLivePreds = [],
  groupMatches = [],
  teams = [],
  qualifyPreds = [],
}: Props) {
  const [scores, setScores] = useState<ScoreRow[]>(initialScores)
  const [liveMatches, setLiveMatches] = useState<LiveMatchLite[]>(initialLiveMatches)
  const [livePreds, setLivePreds] = useState<LivePred[]>(initialLivePreds)
  const prevRanks = useRef<Map<string, number>>(new Map())
  const [flashMap, setFlashMap] = useState<Map<string, 'up' | 'down'>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ── Puntos tentativos en vivo por participante, separados por bucket ─────────
  // grupos vs eliminación según la fase del partido en vivo, para que el desglose
  // se mueva en el bucket correcto igual que la columna Partidos.
  const liveDeltaByParticipant = useMemo(() => {
    const delta = new Map<string, { grupos: number; eliminacion: number }>()
    if (liveMatches.length === 0) return delta
    const scoreByMatch = new Map(liveMatches.map((m) => [m.id, m]))
    for (const pred of livePreds) {
      const m = scoreByMatch.get(pred.match_id)
      if (!m || m.goles_local === null || m.goles_visitante === null) continue
      const pts = scoreGroupMatch(
        { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
        { golesLocal: m.goles_local, golesVisitante: m.goles_visitante },
      ).total
      if (pts <= 0) continue
      const cur = delta.get(pred.participant_id) ?? { grupos: 0, eliminacion: 0 }
      if (m.fase === 'grupos') cur.grupos += pts
      else cur.eliminacion += pts
      delta.set(pred.participant_id, cur)
    }
    return delta
  }, [liveMatches, livePreds])

  // ── Clasificados tentativos en vivo (1º/2º) ─────────────────────────────────
  // Para los grupos que tienen un partido EN VIVO, calcula la tabla provisional
  // con el marcador actual y adjudica tentativo de 1º/2º contra los pronósticos.
  // Los mejores terceros (pos 3) no son tentativos: solo se saben al cerrar los 12
  // grupos. Estos grupos aún no son oficiales → no hay doble conteo con total_clasificados.
  const qualifyLiveDeltaByParticipant = useMemo(() => {
    const delta = new Map<string, number>()
    const liveGroupMatches = liveMatches.filter((m) => m.fase === 'grupos')
    if (liveGroupMatches.length === 0 || groupMatches.length === 0) return delta
    const liveById = new Map(liveGroupMatches.map((m) => [m.id, m]))

    // Grupos con al menos un partido en vivo ahora mismo
    const liveGroups = new Set<string>()
    for (const gm of groupMatches) if (liveById.has(gm.id)) liveGroups.add(gm.grupo)
    if (liveGroups.size === 0) return delta

    // Tabla provisional → 1º/2º por grupo en vivo
    const classified: QualifyOfficial['classified'] = {}
    for (const grupo of liveGroups) {
      const groupTeams = teams.filter((t) => t.grupo === grupo)
      if (groupTeams.length === 0) continue
      const standingMatches = []
      for (const gm of groupMatches) {
        if (gm.grupo !== grupo) continue
        const live = liveById.get(gm.id)
        const gl = live ? live.goles_local : gm.golesLocal
        const gv = live ? live.goles_visitante : gm.golesVisitante
        if (gl === null || gv === null) continue // partido sin jugar aún
        standingMatches.push({
          equipoLocalId: gm.equipoLocalId,
          equipoVisitanteId: gm.equipoVisitanteId,
          golesLocal: gl,
          golesVisitante: gv,
        })
      }
      if (standingMatches.length === 0) continue
      const { rows } = computeGroupStandings(standingMatches, groupTeams)
      const primero = rows.find((r) => r.posicion === 1)
      const segundo = rows.find((r) => r.posicion === 2)
      if (primero) classified[primero.teamNombre] = { grupo, posicion: 1 }
      if (segundo) classified[segundo.teamNombre] = { grupo, posicion: 2 }
    }

    const official: QualifyOfficial = { classified, bestThirds: [] }
    const predsByPart = new Map<string, QualifyPred[]>()
    for (const p of qualifyPreds) {
      if (!liveGroups.has(p.grupo) || (p.posicion !== 1 && p.posicion !== 2)) continue
      const arr = predsByPart.get(p.participant_id) ?? []
      arr.push({ grupo: p.grupo, posicion: p.posicion as 1 | 2, teamNombre: p.teamNombre })
      predsByPart.set(p.participant_id, arr)
    }
    for (const [pid, preds] of predsByPart) {
      const pts = scoreQualify(preds, official).total
      if (pts > 0) delta.set(pid, pts)
    }
    return delta
  }, [liveMatches, groupMatches, teams, qualifyPreds])

  const hasLive = liveMatches.length > 0

  // ── Tabla efectiva (total + tentativo), ordenada ────────────────────────────
  const displayScores = useMemo(() => {
    return scores
      .map((row) => {
        const live = liveDeltaByParticipant.get(row.participant_id) ?? { grupos: 0, eliminacion: 0 }
        const liveDelta = live.grupos + live.eliminacion
        const clasifLive = qualifyLiveDeltaByParticipant.get(row.participant_id) ?? 0
        // Puntos SOLO de partidos (grupos + eliminación). El tentativo en vivo es de partidos.
        const partidos = row.total_grupos + row.total_eliminacion + liveDelta
        // El Total tentativo incluye también los clasificados tentativos (no van a Partidos).
        return { row, live, liveDelta, clasifLive, partidos, effectiveTotal: row.total + liveDelta + clasifLive }
      })
      .sort((a, b) => b.effectiveTotal - a.effectiveTotal)
  }, [scores, liveDeltaByParticipant, qualifyLiveDeltaByParticipant])

  // ── Animación de cambios de posición (incluye reordenamiento por puntos en vivo)
  useEffect(() => {
    const newRanks = new Map(displayScores.map((s, i) => [s.row.participant_id, i]))
    if (prevRanks.current.size > 0) {
      const newFlash = new Map<string, 'up' | 'down'>()
      for (const [pid, newRank] of newRanks.entries()) {
        const oldRank = prevRanks.current.get(pid)
        if (oldRank !== undefined && oldRank !== newRank) {
          newFlash.set(pid, newRank < oldRank ? 'up' : 'down')
        }
      }
      if (newFlash.size > 0) {
        setFlashMap(newFlash)
        const t = setTimeout(() => setFlashMap(new Map()), 2000)
        prevRanks.current = newRanks
        return () => clearTimeout(t)
      }
    }
    prevRanks.current = newRanks
  }, [displayScores])

  // ── Realtime: scores_cache + matches (para el tentativo en vivo) ─────────────
  useEffect(() => {
    const supabase = createClient()

    async function refetchScores() {
      const { data } = await supabase
        .from('scores_cache')
        .select('*, participants(id, nombre, sheet_alias, avatar_url)')
        .order('total', { ascending: false })
      if (data) setScores(data as unknown as ScoreRow[])
    }

    async function refetchLive() {
      const { data: lm } = await supabase
        .from('matches')
        .select('id, fase, goles_local, goles_visitante')
        .eq('estado', 'live')
      const matches = (lm ?? []) as LiveMatchLite[]
      setLiveMatches(matches)
      const ids = matches.map((m) => m.id)
      if (ids.length > 0) {
        const { data: preds } = await supabase
          .from('predictions_group')
          .select('participant_id, match_id, pred_local, pred_visitante')
          .in('match_id', ids)
        setLivePreds((preds ?? []) as LivePred[])
      } else {
        setLivePreds([])
      }
    }

    const channel = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores_cache' }, refetchScores)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, refetchLive)
      .subscribe()

    // Refresco en segundo plano (no depende de Realtime ni de recargar la página):
    // si hay partidos en vivo, le pide al backend marcadores frescos de TheSportsDB
    // y vuelve a leer todo. Así la tabla se actualiza sola con cada gol.
    async function backgroundRefresh() {
      const { data: lm } = await supabase
        .from('matches')
        .select('id')
        .eq('estado', 'live')
      const hayVivo = (lm ?? []).length > 0
      if (hayVivo) {
        try { await fetch('/api/live/poll', { method: 'POST' }) } catch {}
      }
      await refetchLive()
      await refetchScores()
    }

    const interval = setInterval(backgroundRefresh, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [])

  if (scores.length === 0) {
    return (
      <div className="text-center py-16 text-[#768390]">
        <p className="text-4xl mb-3">⚽</p>
        <p>Sin datos aún. El admin debe importar los pronósticos.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      {hasLive && (
        <p className="text-xs text-[#768390] mb-2 flex items-center gap-1.5">
          <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#f85149]" />
          Puntos <span className="text-[#9EE637] font-semibold">en vivo</span> tentativos según el marcador actual
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#30363d] text-[#768390] text-xs uppercase tracking-wide">
            <th className="text-left pb-3 pr-4 w-8">#</th>
            <th className="text-left pb-3 pr-4">Participante</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Grupos</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Clasif.</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Semis</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Preguntas</th>
            <th className="text-right pb-3 px-2 text-[#9EE637]">
              Partidos
              <span className="block text-[#444d56] text-[10px] font-normal normal-case tracking-normal">
                solo partidos
              </span>
            </th>
            <th className="text-right pb-3 pl-4 font-bold text-[#e6edf3]">
              Total
              <span className="block text-[#444d56] text-[10px] font-normal normal-case tracking-normal">
                todo
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {displayScores.map(({ row, live, liveDelta, clasifLive, partidos, effectiveTotal }, idx) => {
            const flash = flashMap.get(row.participant_id)
            const participante = row.participants
            const href = `/participant/${participante?.id ?? row.participant_id}`
            const isLiveScoring = liveDelta > 0
            const isOpen = expanded.has(row.participant_id)
            return (
              <Fragment key={row.participant_id}>
              <tr
                onClick={() => toggleExpanded(row.participant_id)}
                aria-expanded={isOpen}
                className={`
                  border-b border-[#21262d] transition-colors cursor-pointer
                  hover:bg-[#161b22]
                  ${isLiveScoring ? 'bg-[#9EE637]/5' : ''}
                  ${isOpen ? 'bg-[#161b22]' : ''}
                  ${flash === 'up' ? 'rank-up' : ''}
                  ${flash === 'down' ? 'rank-down' : ''}
                `}
              >
                <td className="py-3 pr-4 text-[#768390] font-mono text-xs">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                </td>

                <td className="py-3 pr-4">
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-[#e6edf3] hover:text-[#9EE637] transition-colors"
                  >
                    {participante?.nombre ?? row.participant_id}
                  </Link>
                </td>

                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390] tabular-nums">
                  {row.total_grupos}
                </td>
                <td className={`py-3 px-2 text-right hidden sm:table-cell tabular-nums ${clasifLive > 0 ? 'text-[#9EE637] font-semibold' : 'text-[#768390]'}`}>
                  {row.total_clasificados + clasifLive}
                </td>
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390] tabular-nums">
                  {row.total_semis}
                </td>
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390] tabular-nums">
                  {row.total_preguntas}
                </td>

                {/* Partidos (solo grupos + eliminación, con tentativo en vivo) */}
                <td className="py-3 px-2 text-right">
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    {isLiveScoring && (
                      <span className="text-[10px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">
                        +{liveDelta}
                      </span>
                    )}
                    <span className="font-semibold tabular-nums text-[#9EE637]">{partidos}</span>
                  </span>
                </td>

                {/* Total (todo) + chevron de expandir */}
                <td className="py-3 pl-4 text-right">
                  <span className="inline-flex items-center gap-2 justify-end">
                    <span>
                      <span className="font-bold tabular-nums text-base text-[#e6edf3]">
                        {effectiveTotal}
                      </span>
                      <span className="text-[#768390] text-xs font-normal"> pts</span>
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      className={`w-4 h-4 text-[#768390] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                </td>
              </tr>

              {/* Panel de desglose: de dónde vienen los puntos (se mueve en vivo) */}
              {isOpen && (
                <tr className="border-b border-[#21262d] bg-[#0d1117]">
                  <td colSpan={8} className="px-4 pb-4 pt-1">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <BreakdownChip label="Grupos" value={row.total_grupos} live={live.grupos} />
                      <BreakdownChip label="Eliminación" value={row.total_eliminacion} live={live.eliminacion} />
                      <BreakdownChip label="Clasificados" value={row.total_clasificados} live={clasifLive} />
                      <BreakdownChip label="Semis" value={row.total_semis} />
                      <BreakdownChip label="Preguntas" value={row.total_preguntas} />
                    </div>
                    <Link
                      href={href}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-block mt-3 text-xs font-medium text-[#9EE637] hover:underline"
                    >
                      Ver perfil completo →
                    </Link>
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Chip de un bucket de puntos en el desglose. `live` = puntos tentativos en
 *  vivo de ese bucket; si >0 se muestra con badge animado y se suma al valor. */
function BreakdownChip({ label, value, live = 0 }: { label: string; value: number; live?: number }) {
  const hasLive = live > 0
  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <span className="text-xs text-[#768390]">{label}</span>
      <span className="inline-flex items-center gap-1.5">
        {hasLive && (
          <span className="text-[10px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">
            +{live}
          </span>
        )}
        <span className={`font-semibold tabular-nums ${hasLive ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
          {value + live}
        </span>
      </span>
    </div>
  )
}
