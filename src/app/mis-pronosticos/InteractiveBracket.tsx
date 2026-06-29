'use client'

import { useEffect, useMemo, useState } from 'react'
import TeamFlag from '@/components/ui/TeamFlag'
import { saveBracketSlot } from './actions'
import {
  BRACKET_BY_ROUND,
  ROUND_LABELS,
  ROUND_ORDER,
  type RoundKey,
  type BracketSlot,
} from '@/config/bracket2026'

const TZ = 'America/Bogota'

export interface TeamRef {
  id: string
  nombre: string
}

export interface RealSlot {
  slot: string
  localId: string | null
  visitanteId: string | null
  kickoffAt: string | null
  estado: string
  golesLocal: number | null
  golesVisitante: number | null
  advancerTeamId: string | null
}

export interface MyPick {
  slot: string
  advancerTeamId: string | null
  predLocal: number | null
  predVisitante: number | null
}

interface PickState {
  advancer: string | null
  local: string
  visitante: string
}

function fmtClose(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

/** Cuenta regresiva legible hasta el cierre. */
function countdown(ms: number): string {
  if (ms <= 0) return 'cerrado'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── Componente principal ─────────────────────────────────────

export default function InteractiveBracket({
  teams,
  realSlots,
  myPicks,
  counts,
  openRounds,
  deadlineMinutes,
  bracketActivatedAt,
  totalParticipantes,
}: {
  teams: TeamRef[]
  realSlots: RealSlot[]
  myPicks: MyPick[]
  counts: { slot: string; n: number }[]
  openRounds: string[]
  deadlineMinutes: number
  bracketActivatedAt: string | null
  totalParticipantes: number
}) {
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams])
  const realBySlot = useMemo(() => new Map(realSlots.map((r) => [r.slot, r])), [realSlots])
  const countBySlot = useMemo(() => new Map(counts.map((c) => [c.slot, c.n])), [counts])

  // Modelo ronda-por-ronda: cada partido usa los EQUIPOS REALES que pasaron
  // (no los picks del usuario). Las rondas futuras aún no tienen partidos.
  const [picks, setPicks] = useState<Record<string, PickState>>(() => {
    const init: Record<string, PickState> = {}
    for (const p of myPicks) {
      init[p.slot] = {
        advancer: p.advancerTeamId,
        local: p.predLocal?.toString() ?? '',
        visitante: p.predVisitante?.toString() ?? '',
      }
    }
    return init
  })

  // Inicia en 0 (evita desajuste SSR/hidratación); se fija al montar y tictac cada segundo.
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  function setPick(slot: string, patch: Partial<PickState>) {
    setPicks((prev) => {
      const base: PickState = prev[slot] ?? { advancer: null, local: '', visitante: '' }
      return { ...prev, [slot]: { ...base, ...patch } }
    })
  }

  // Ronda "activa" a expandir por defecto = la primera con un partido por jugarse.
  const activeRound = ROUND_ORDER.find((r) => {
    const rs = BRACKET_BY_ROUND.find((x) => x.round === r)?.slots ?? []
    return rs.some((s) => realBySlot.get(s.slot)?.estado === 'scheduled')
  })

  return (
    <div className="space-y-2.5">
      {BRACKET_BY_ROUND.map(({ round, slots }, idx) => {
        // Partidos reales de la ronda, ordenados cronológicamente (primero los que se juegan antes)
        const withMatch = slots
          .map((s) => ({ slotDef: s, real: realBySlot.get(s.slot) }))
          .filter((x) => x.real)
          .sort((a, b) => {
            const ta = a.real?.kickoffAt ? new Date(a.real.kickoffAt).getTime() : Infinity
            const tb = b.real?.kickoffAt ? new Date(b.real.kickoffAt).getTime() : Infinity
            return ta - tb
          })
        const hasMatches = withMatch.length > 0
        const prevLabel = idx > 0 ? ROUND_LABELS[ROUND_ORDER[idx - 1]] : ''
        return (
          <RoundSection
            key={round}
            round={round}
            items={withMatch}
            totalSlots={slots.length}
            hasMatches={hasMatches}
            defaultOpen={round === activeRound}
            prevLabel={prevLabel}
            roundOpen={openRounds.includes(round)}
            now={now}
            deadlineMinutes={deadlineMinutes}
            bracketActivatedAt={bracketActivatedAt}
            picks={picks}
            teamsById={teamsById}
            countBySlot={countBySlot}
            totalParticipantes={totalParticipantes}
            onPick={setPick}
          />
        )
      })}
    </div>
  )
}

// ─── Sección de ronda (colapsable) ────────────────────────────

function RoundSection({
  round, items, totalSlots, hasMatches, defaultOpen, prevLabel, roundOpen, now, deadlineMinutes,
  bracketActivatedAt, picks, teamsById, countBySlot, totalParticipantes, onPick,
}: {
  round: RoundKey
  items: { slotDef: BracketSlot; real: RealSlot | undefined }[]
  totalSlots: number
  hasMatches: boolean
  defaultOpen: boolean
  prevLabel: string
  roundOpen: boolean
  now: number
  deadlineMinutes: number
  bracketActivatedAt: string | null
  picks: Record<string, PickState>
  teamsById: Map<string, TeamRef>
  countBySlot: Map<string, number>
  totalParticipantes: number
  onPick: (slot: string, patch: Partial<PickState>) => void
}) {
  // Expande por defecto la ronda activa (la que tiene partidos por jugarse).
  const [open, setOpen] = useState(defaultOpen)

  // Ronda futura sin partidos todavía → bloqueada
  if (!hasMatches) {
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl px-4 py-3 flex items-center justify-between opacity-70">
        <span className="text-sm font-semibold text-[#768390]">{ROUND_LABELS[round]}</span>
        <span className="text-[11px] text-[#768390]">🔒 Se abre cuando termine {prevLabel}</span>
      </div>
    )
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1c2330] transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#e6edf3]">{ROUND_LABELS[round]}</span>
          {roundOpen
            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#9EE637]/15 text-[#9EE637]">Abierto</span>
            : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#768390]/15 text-[#768390]">Cerrado</span>}
        </span>
        <span className="flex items-center gap-2 text-[#768390]">
          <span className="text-xs tabular-nums">{items.length}/{totalSlots}</span>
          <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        </span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {items.map(({ slotDef, real }, i) => (
            <SlotCard
              key={slotDef.slot}
              slot={slotDef.slot}
              matchNo={i + 1}
              roundLabel={ROUND_LABELS[round]}
              roundOpen={roundOpen}
              now={now}
              deadlineMinutes={deadlineMinutes}
              bracketActivatedAt={bracketActivatedAt}
              real={real}
              pick={picks[slotDef.slot]}
              teamsById={teamsById}
              predCount={countBySlot.get(slotDef.slot) ?? 0}
              totalParticipantes={totalParticipantes}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de un partido (compacta) ─────────────────────────

function SlotCard({
  slot, matchNo, roundLabel, roundOpen, now, deadlineMinutes, bracketActivatedAt,
  real, pick, teamsById, predCount, totalParticipantes, onPick,
}: {
  slot: string
  matchNo: number
  roundLabel: string
  roundOpen: boolean
  now: number
  deadlineMinutes: number
  bracketActivatedAt: string | null
  real: RealSlot | undefined
  pick: PickState | undefined
  teamsById: Map<string, TeamRef>
  predCount: number
  totalParticipantes: number
  onPick: (slot: string, patch: Partial<PickState>) => void
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  const localId = real?.localId ?? null
  const visitanteId = real?.visitanteId ?? null
  const localName = localId ? teamsById.get(localId)?.nombre ?? '—' : null
  const visitanteName = visitanteId ? teamsById.get(visitanteId)?.nombre ?? '—' : null
  const bothKnown = !!localId && !!visitanteId

  // El que avanza se DERIVA del marcador: el que gana avanza automáticamente.
  // Solo si el marcador es empate se pregunta explícitamente quién pasa.
  const pl = pick?.local && pick.local !== '' ? parseInt(pick.local, 10) : null
  const pv = pick?.visitante && pick.visitante !== '' ? parseInt(pick.visitante, 10) : null
  const bothFilled = pl !== null && pv !== null
  const isTie = bothFilled && pl === pv
  const derivedWinner = !bothFilled ? null : pl! > pv! ? localId : pv! > pl! ? visitanteId : null
  // El advancer guardado solo importa para desempates.
  const tiePick = pick?.advancer && (pick.advancer === localId || pick.advancer === visitanteId) ? pick.advancer : null
  const advancerId = isTie ? tiePick : derivedWinner

  const finished = real?.estado === 'finished'
  const live = real?.estado === 'live'
  const hasResult = real?.golesLocal != null && real?.golesVisitante != null

  const deadlineMs = real?.kickoffAt ? new Date(real.kickoffAt).getTime() - deadlineMinutes * 60_000 : null
  const participates =
    !real?.kickoffAt || !bracketActivatedAt ||
    new Date(real.kickoffAt).getTime() >= new Date(bracketActivatedAt).getTime()
  const windowOpen = real?.estado === 'scheduled' && participates && (deadlineMs === null || now < deadlineMs)
  const editable = roundOpen && windowOpen && bothKnown

  async function persist(advancer: string | null, local: string, visitante: string) {
    setStatus('saving'); setMsg('')
    const pl = local !== '' ? parseInt(local, 10) : null
    const pv = visitante !== '' ? parseInt(visitante, 10) : null
    const r = await saveBracketSlot(slot, advancer, pl, pv)
    if (r.ok) { setStatus('saved'); setMsg('Guardado ✓') }
    else { setStatus('error'); setMsg(r.error ?? 'Error') }
  }
  // Solo se usa para desempates: en empate el usuario elige quién pasa.
  function pickTie(teamId: string) {
    if (!editable) return
    onPick(slot, { advancer: teamId })
    setStatus('idle'); setMsg('')
  }
  function setScore(side: 'local' | 'visitante', v: string) {
    const clean = v.replace(/[^0-9]/g, '').slice(0, 2) // 0–99
    onPick(slot, { [side]: clean })
    setStatus('idle'); setMsg('')
  }
  function saveAll() {
    if (status === 'saving') return
    // Persiste el avance VALIDADO (advancerId) + el marcador actual, en una sola escritura.
    void persist(advancerId, pick?.local ?? '', pick?.visitante ?? '')
  }

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[#768390]">{roundLabel} · Partido {matchNo}</span>
        <StatusPill editable={editable} finished={finished} live={live} />
      </div>

      {bothKnown ? (
        <div className="space-y-1.5">
          <TeamRow
            name={localName!} selected={advancerId === localId} editable={editable}
            score={pick?.local ?? ''} result={hasResult ? real!.golesLocal : null}
            onScore={(v) => setScore('local', v)}
          />
          <TeamRow
            name={visitanteName!} selected={advancerId === visitanteId} editable={editable}
            score={pick?.visitante ?? ''} result={hasResult ? real!.golesVisitante : null}
            onScore={(v) => setScore('visitante', v)}
          />
          {editable && isTie && (
            <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
              <span className="text-[10px] text-[#f0a35e] font-semibold shrink-0">Empate — ¿quién pasa?</span>
              <button
                onClick={() => pickTie(localId!)}
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${
                  advancerId === localId ? 'bg-[#9EE637] text-[#0d1117]' : 'bg-[#161b22] border border-[#30363d] text-[#e6edf3]'
                }`}
              >{localName}</button>
              <button
                onClick={() => pickTie(visitanteId!)}
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${
                  advancerId === visitanteId ? 'bg-[#9EE637] text-[#0d1117]' : 'bg-[#161b22] border border-[#30363d] text-[#e6edf3]'
                }`}
              >{visitanteName}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center text-xs text-[#768390] py-2">Equipos por definir</div>
      )}

      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] truncate">
          {finished && hasResult ? (
            <span className="text-[#58a6ff]">Final · {real!.golesLocal}–{real!.golesVisitante}</span>
          ) : live && hasResult ? (
            <span className="text-[#f85149]">🔴 {real!.golesLocal}–{real!.golesVisitante}</span>
          ) : editable && deadlineMs !== null ? (
            <span className={deadlineMs - now < 3_600_000 ? 'text-[#f0a35e] font-semibold' : 'text-[#9EE637] font-medium'}>
              ⏱ Cierra en {countdown(deadlineMs - now)}
            </span>
          ) : !roundOpen ? (
            <span className="text-[#768390]">Ronda aún cerrada</span>
          ) : real?.kickoffAt ? (
            <span className="text-[#768390]">Inicio {fmtClose(real.kickoffAt)}</span>
          ) : null}
        </span>
        {editable && (
          <button
            onClick={saveAll}
            disabled={status === 'saving'}
            className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
          >
            {status === 'saving' ? '…' : 'Guardar'}
          </button>
        )}
      </div>

      {msg && <p className={`text-[10px] mt-1 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</p>}
      {predCount > 0 && <p className="text-[10px] text-[#768390] mt-1">📊 {predCount}/{totalParticipantes} predicciones</p>}
    </div>
  )
}

function TeamRow({
  name, selected, editable, score, result, onScore,
}: {
  name: string; selected: boolean; editable: boolean; score: string
  result: number | null; onScore: (v: string) => void
}) {
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
      selected ? 'border-[#9EE637] bg-[#9EE637]/10' : 'border-[#30363d] bg-[#161b22]'
    }`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <TeamFlag nombre={name} size={18} />
        <span className={`text-sm font-semibold truncate ${selected ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>{name}</span>
        {selected && <span className="text-[#9EE637] text-xs shrink-0">✓ avanza</span>}
      </div>
      {editable ? (
        <input
          type="number" min={0} max={99} inputMode="numeric"
          value={score}
          onChange={(e) => onScore(e.target.value)}
          placeholder="–"
          className="w-11 px-1 py-1 text-center text-base font-bold rounded bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
        />
      ) : (
        <span className="w-11 text-center text-base font-black tabular-nums text-[#768390]">{score === '' ? '–' : score}</span>
      )}
      {result !== null && (
        <span className="text-xs text-[#58a6ff] tabular-nums w-4 text-center" title="Resultado oficial">{result}</span>
      )}
    </div>
  )
}

function StatusPill({ editable, finished, live }: { editable: boolean; finished: boolean; live: boolean }) {
  if (live) {
    return (
      <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f85149]/15 text-[#f85149] inline-flex items-center gap-1">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#f85149]" /> En vivo
      </span>
    )
  }
  if (finished) {
    return <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#58a6ff]/15 text-[#58a6ff]">Final</span>
  }
  if (editable) {
    return <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#9EE637]/15 text-[#9EE637]">Abierto</span>
  }
  return <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#768390]/15 text-[#768390]">🔒 Cerrado</span>
}
