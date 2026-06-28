'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { scoreGroupMatch, scoreQualify, type QualifyPred, type QualifyOfficial } from '@/lib/scoring'
import { computeGroupStandings } from '@/lib/standings'

export type LeaderboardScope = 'general' | 'grupos' | 'eliminacion'

interface ScoreRow {
  participant_id: string
  total: number
  total_grupos: number
  total_eliminacion: number
  total_r32: number
  total_r16: number
  total_qf: number
  total_sf: number
  total_final: number
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
  scope?: LeaderboardScope
  initialLiveMatches?: LiveMatchLite[]
  initialLivePreds?: LivePred[]
  groupMatches?: GroupMatchLite[]
  teams?: TeamLite[]
  qualifyPreds?: QualifyPredLite[]
}

// Mapeo fase real → bucket de ronda (para tentativo en vivo y chips)
type RoundBucket = 'r32' | 'r16' | 'qf' | 'sf' | 'final'
const FASE_TO_ROUND: Record<string, RoundBucket> = {
  dieciseisavos: 'r32',
  octavos: 'r16',
  cuartos: 'qf',
  semis: 'sf',
  final: 'final',
  tercer_puesto: 'final',
}

interface LiveDelta {
  grupos: number
  r32: number
  r16: number
  qf: number
  sf: number
  final: number
}
const ZERO_DELTA: LiveDelta = { grupos: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0 }
const elimSum = (d: LiveDelta) => d.r32 + d.r16 + d.qf + d.sf + d.final

export default function LeaderboardTable({
  initialScores,
  scope = 'general',
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

  // ── Puntos tentativos en vivo por participante, por bucket (grupos + rondas) ──
  const liveDeltaByParticipant = useMemo(() => {
    const delta = new Map<string, LiveDelta>()
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
      const cur = delta.get(pred.participant_id) ?? { ...ZERO_DELTA }
      if (m.fase === 'grupos') cur.grupos += pts
      else {
        const round = FASE_TO_ROUND[m.fase ?? ''] ?? 'final'
        cur[round] += pts
      }
      delta.set(pred.participant_id, cur)
    }
    return delta
  }, [liveMatches, livePreds])

  // ── Clasificados tentativos en vivo (1º/2º) — solo relevante para grupos ─────
  const qualifyLiveDeltaByParticipant = useMemo(() => {
    const delta = new Map<string, number>()
    const liveGroupMatches = liveMatches.filter((m) => m.fase === 'grupos')
    if (liveGroupMatches.length === 0 || groupMatches.length === 0) return delta
    const liveById = new Map(liveGroupMatches.map((m) => [m.id, m]))

    const liveGroups = new Set<string>()
    for (const gm of groupMatches) if (liveById.has(gm.id)) liveGroups.add(gm.grupo)
    if (liveGroups.size === 0) return delta

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
        if (gl === null || gv === null) continue
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

  // ── Tabla efectiva, ordenada por la métrica del scope ───────────────────────
  const displayScores = useMemo(() => {
    const rows = scores.map((row) => {
      const live = liveDeltaByParticipant.get(row.participant_id) ?? ZERO_DELTA
      const liveElim = elimSum(live)
      const clasifLive = qualifyLiveDeltaByParticipant.get(row.participant_id) ?? 0
      const gruposMetric = row.total_grupos + live.grupos
      const elimMetric = row.total_eliminacion + liveElim
      const generalMetric = row.total + live.grupos + liveElim + clasifLive
      const metric =
        scope === 'grupos' ? gruposMetric : scope === 'eliminacion' ? elimMetric : generalMetric
      // Ganancia tentativa en vivo para el scope actual (badge "+N puntos")
      const liveGain =
        scope === 'grupos' ? live.grupos : scope === 'eliminacion' ? liveElim : live.grupos + liveElim + clasifLive
      return { row, live, liveElim, clasifLive, metric, liveGain }
    })
    rows.sort((a, b) => {
      if (b.metric !== a.metric) return b.metric - a.metric
      // Desempate: puntos en fase de grupos
      const ag = a.row.total_grupos + a.live.grupos
      const bg = b.row.total_grupos + b.live.grupos
      return bg - ag
    })
    return rows
  }, [scores, liveDeltaByParticipant, qualifyLiveDeltaByParticipant, scope])

  const leaderMetric = displayScores.length > 0 ? displayScores[0].metric : 0

  // ── Animación de cambios de posición ────────────────────────────────────────
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

  // ── Realtime: scores_cache + matches ────────────────────────────────────────
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

    async function backgroundRefresh() {
      const { data: lm } = await supabase.from('matches').select('id').eq('estado', 'live')
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

  const scopeLabel =
    scope === 'grupos' ? 'fase de grupos' : scope === 'eliminacion' ? 'eliminación' : 'todo el torneo'

  return (
    <div className="space-y-2.5">
      {hasLive && (
        <p className="text-xs text-[#768390] flex items-center gap-1.5">
          <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#f85149]" />
          Puntos <span className="text-[#9EE637] font-semibold">en vivo</span> tentativos según el marcador actual
        </p>
      )}
      <p className="text-xs text-[#768390]">
        Posiciones por <span className="text-[#e6edf3] font-medium">{scopeLabel}</span> · toca una tarjeta para ver el desglose
      </p>

      {displayScores.map(({ row, live, liveElim, clasifLive, metric, liveGain }, idx) => {
        const flash = flashMap.get(row.participant_id)
        const p = row.participants
        const href = `/participant/${p?.id ?? row.participant_id}`
        const isOpen = expanded.has(row.participant_id)
        const isLeader = idx === 0
        const gap = metric - leaderMetric // <= 0
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null

        // Tarjetas top-3 con tinte; resto neutro
        const rankTint =
          idx === 0
            ? 'border-[#d9a441]/50 bg-gradient-to-br from-[#d9a441]/12 to-transparent'
            : idx === 1
              ? 'border-[#9aa4ad]/40 bg-gradient-to-br from-[#9aa4ad]/10 to-transparent'
              : idx === 2
                ? 'border-[#cd7f32]/40 bg-gradient-to-br from-[#cd7f32]/12 to-transparent'
                : 'border-[#30363d] bg-[#161b22]'

        return (
          <div
            key={row.participant_id}
            className={`
              rounded-xl border transition-colors overflow-hidden
              ${rankTint}
              ${flash === 'up' ? 'rank-up' : ''}
              ${flash === 'down' ? 'rank-down' : ''}
            `}
          >
            <button
              type="button"
              onClick={() => toggleExpanded(row.participant_id)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-white/[0.02]"
            >
              {/* Medalla / posición */}
              <span
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold tabular-nums
                  ${medal ? 'text-lg' : 'bg-[#0d1117] border border-[#30363d] text-[#768390]'}`}
              >
                {medal ?? idx + 1}
              </span>

              {/* Nombre */}
              <div className="flex-1 min-w-0">
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-[#e6edf3] hover:text-[#9EE637] transition-colors block truncate"
                >
                  {p?.nombre ?? row.participant_id}
                </Link>
                {liveGain > 0 && (
                  <span className="text-xs font-semibold text-[#9EE637]">+{liveGain} en vivo</span>
                )}
              </div>

              {/* Total + gap al líder */}
              <div className="shrink-0 text-right">
                <div className="text-2xl font-black tabular-nums text-[#9EE637] leading-none">{metric}</div>
                <div className="text-[11px] mt-1 text-[#768390]">
                  {isLeader ? <span className="text-[#9EE637] font-semibold">Líder</span> : `${gap} pts`}
                </div>
              </div>

              {/* Chevron */}
              <svg
                viewBox="0 0 24 24"
                className={`w-4 h-4 text-[#768390] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {/* Desglose: chips por fase */}
            {isOpen && (
              <div className="px-3.5 pb-3.5 pt-1 border-t border-white/5">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  <PhaseChip label="Grupos" value={row.total_grupos} live={live.grupos} highlight={scope === 'grupos'} />
                  <PhaseChip label="R32" value={row.total_r32} live={live.r32} highlight={scope === 'eliminacion'} />
                  <PhaseChip label="R16" value={row.total_r16} live={live.r16} highlight={scope === 'eliminacion'} />
                  <PhaseChip label="QF" value={row.total_qf} live={live.qf} highlight={scope === 'eliminacion'} />
                  <PhaseChip label="SF" value={row.total_sf} live={live.sf} highlight={scope === 'eliminacion'} />
                  <PhaseChip label="Final" value={row.total_final} live={live.final} highlight={scope === 'eliminacion'} />
                  <PhaseChip label="Clasif." value={row.total_clasificados} live={clasifLive} />
                  <PhaseChip label="Preguntas" value={row.total_preguntas} />
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-[11px] text-[#768390]">
                    Eliminación: <span className="text-[#e6edf3] font-medium tabular-nums">{row.total_eliminacion + liveElim}</span>
                    {' · '}Total: <span className="text-[#e6edf3] font-medium tabular-nums">{row.total + live.grupos + liveElim + clasifLive}</span>
                  </span>
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-medium text-[#9EE637] hover:underline"
                  >
                    Ver perfil →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Chip de un bucket de puntos. `highlight` marca la fase del scope actual. */
function PhaseChip({
  label, value, live = 0, highlight = false,
}: { label: string; value: number; live?: number; highlight?: boolean }) {
  const hasLive = live > 0
  const empty = value === 0 && !hasLive
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border
        ${highlight ? 'border-[#9EE637]/40 bg-[#9EE637]/5' : 'border-[#21262d] bg-[#0d1117]'}`}
    >
      <div className="text-[10px] text-[#768390] uppercase tracking-wide truncate">{label}</div>
      <div className="flex items-center gap-1 mt-0.5">
        {hasLive && (
          <span className="text-[9px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1 py-0.5 rounded animate-pulse">
            +{live}
          </span>
        )}
        <span className={`text-sm font-semibold tabular-nums ${empty ? 'text-[#484f58]' : hasLive ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
          {empty ? '–' : value + live}
        </span>
      </div>
    </div>
  )
}
