'use client'

import { Fragment, useEffect, useState, useRef, useMemo } from 'react'
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

interface Bucket { key: string; label: string; value: number; live: number }

/**
 * Buckets de puntos que se muestran según la polla:
 *  - grupos (Polla 1): Grupos, Clasif, Semis (puestos/semifinalistas), Preguntas.
 *    NO incluye eliminación (R32..Final), que se juega en la Polla 2.
 *  - eliminacion (Polla 2): R32, R16, QF, SF, Final.
 *  - general: todo (grupos + eliminación agregada + clasif + semis + preguntas).
 * El total de cada polla = suma de sus buckets.
 */
function buildBuckets(
  scope: LeaderboardScope,
  row: ScoreRow,
  live: LiveDelta,
  liveElim: number,
  clasifLive: number,
): Bucket[] {
  if (scope === 'eliminacion') {
    return [
      { key: 'r32', label: 'R32', value: row.total_r32, live: live.r32 },
      { key: 'r16', label: 'R16', value: row.total_r16, live: live.r16 },
      { key: 'qf', label: 'QF', value: row.total_qf, live: live.qf },
      { key: 'sf', label: 'SF', value: row.total_sf, live: live.sf },
      { key: 'final', label: 'Final', value: row.total_final, live: live.final },
    ]
  }
  if (scope === 'grupos') {
    return [
      { key: 'grupos', label: 'Grupos', value: row.total_grupos, live: live.grupos },
      { key: 'clasif', label: 'Clasif', value: row.total_clasificados, live: clasifLive },
      { key: 'semis', label: 'Semis', value: row.total_semis, live: 0 },
      { key: 'preg', label: 'Preg', value: row.total_preguntas, live: 0 },
    ]
  }
  return [
    { key: 'grupos', label: 'Grupos', value: row.total_grupos, live: live.grupos },
    { key: 'elim', label: 'Elim', value: row.total_eliminacion, live: liveElim },
    { key: 'clasif', label: 'Clasif', value: row.total_clasificados, live: clasifLive },
    { key: 'semis', label: 'Semis', value: row.total_semis, live: 0 },
    { key: 'preg', label: 'Preg', value: row.total_preguntas, live: 0 },
  ]
}

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

  // ── Tabla efectiva: total = suma de los buckets de la polla; ordenada ────────
  const displayScores = useMemo(() => {
    const rows = scores.map((row) => {
      const live = liveDeltaByParticipant.get(row.participant_id) ?? ZERO_DELTA
      const liveElim = elimSum(live)
      const clasifLive = qualifyLiveDeltaByParticipant.get(row.participant_id) ?? 0
      const buckets = buildBuckets(scope, row, live, liveElim, clasifLive)
      const metric = buckets.reduce((s, b) => s + b.value + b.live, 0)
      const liveGain = buckets.reduce((s, b) => s + b.live, 0)
      return { row, live, buckets, metric, liveGain }
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
    scope === 'grupos' ? 'Etapa 1 (grupos + clasificados + preguntas)'
    : scope === 'eliminacion' ? 'eliminación' : 'todo el torneo'

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

      {displayScores.map(({ row, buckets, metric, liveGain }, idx) => {
        const flash = flashMap.get(row.participant_id)
        const p = row.participants
        const href = `/participant/${p?.id ?? row.participant_id}`
        const isOpen = expanded.has(row.participant_id)
        const isLeader = idx === 0
        const gap = metric - leaderMetric // <= 0
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null

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

              {/* Nombre + columnas inline (buckets de la polla) */}
              <div className="flex-1 min-w-0">
                <Link
                  href={href}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-[#e6edf3] hover:text-[#9EE637] transition-colors block truncate"
                >
                  {p?.nombre ?? row.participant_id}
                </Link>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-[11px] text-[#768390]">
                  {buckets.map((b, i) => (
                    <Fragment key={b.key}>
                      {i > 0 && <span className="text-[#30363d]">·</span>}
                      <InlineStat label={b.label} value={b.value + b.live} live={b.live} />
                    </Fragment>
                  ))}
                </div>
              </div>

              {/* Total de la polla + gap al líder */}
              <div className="shrink-0 text-right">
                {liveGain > 0 && (
                  <span className="text-[10px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded animate-pulse">
                    +{liveGain}
                  </span>
                )}
                <div className="text-2xl font-black tabular-nums text-[#9EE637] leading-none mt-0.5">{metric}</div>
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

            {/* Desglose: chips de los buckets de la polla */}
            {isOpen && (
              <div className="px-3.5 pb-3.5 pt-1 border-t border-white/5">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {buckets.map((b) => (
                    <PhaseChip key={b.key} label={b.label} value={b.value} live={b.live} />
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-[11px] text-[#768390]">
                    Total: <span className="text-[#9EE637] font-bold tabular-nums">{metric}</span>
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

/** Columna inline dentro de la tarjeta (Grupos · Clasif · …). */
function InlineStat({ label, value, live = 0 }: { label: string; value: number; live?: number }) {
  const hasLive = live > 0
  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{label}</span>
      <span className={`tabular-nums font-semibold ${hasLive ? 'text-[#9EE637]' : 'text-[#adbac7]'}`}>{value}</span>
      {hasLive && <span className="text-[9px] text-[#9EE637]">+{live}</span>}
    </span>
  )
}

/** Chip de un bucket de puntos en el desglose expandido. */
function PhaseChip({ label, value, live = 0 }: { label: string; value: number; live?: number }) {
  const hasLive = live > 0
  const empty = value === 0 && !hasLive
  return (
    <div className="rounded-lg px-2.5 py-1.5 border border-[#21262d] bg-[#0d1117]">
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
