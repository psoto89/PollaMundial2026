'use client'

import { useEffect, useMemo, useState } from 'react'
import TeamFlag from '@/components/ui/TeamFlag'
import { saveBracketSlot } from './actions'
import {
  BRACKET_BY_ROUND,
  ROUND_LABELS,
  type RoundKey,
  type BracketSlot,
  type SlotSource,
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

interface Resolved {
  localId: string | null
  visitanteId: string | null
  advancerId: string | null
}

// ─── Helpers de fecha (hora Colombia) ─────────────────────────

function fmtClose(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
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

  const [picks, setPicks] = useState<Record<string, PickState>>(() => {
    const init: Record<string, PickState> = {}
    const byMine = new Map(myPicks.map((p) => [p.slot, p]))
    for (const r of realSlots) {
      const mine = byMine.get(r.slot)
      if (!mine?.advancerTeamId && r.advancerTeamId) {
        init[r.slot] = { advancer: r.advancerTeamId, local: '', visitante: '' }
      }
    }
    for (const p of myPicks) {
      init[p.slot] = {
        advancer: p.advancerTeamId,
        local: p.predLocal?.toString() ?? '',
        visitante: p.predVisitante?.toString() ?? '',
      }
    }
    return init
  })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const resolved = useMemo(() => resolveBracket(picks, realBySlot), [picks, realBySlot])

  function setPick(slot: string, patch: Partial<PickState>) {
    setPicks((prev) => {
      const base: PickState = prev[slot] ?? { advancer: null, local: '', visitante: '' }
      return { ...prev, [slot]: { ...base, ...patch } }
    })
  }

  return (
    <div className="space-y-2.5">
      {BRACKET_BY_ROUND.map(({ round, slots }) => {
        const definidos = slots.filter((s) => resolved.get(s.slot)?.advancerId).length
        return (
          <RoundSection
            key={round}
            round={round}
            slotDefs={slots}
            definidos={definidos}
            roundOpen={openRounds.includes(round)}
            now={now}
            deadlineMinutes={deadlineMinutes}
            bracketActivatedAt={bracketActivatedAt}
            resolved={resolved}
            picks={picks}
            teamsById={teamsById}
            realBySlot={realBySlot}
            countBySlot={countBySlot}
            totalParticipantes={totalParticipantes}
            onPick={setPick}
          />
        )
      })}
    </div>
  )
}

// ─── Resolución del árbol ─────────────────────────────────────

function resolveBracket(
  picks: Record<string, PickState>,
  realBySlot: Map<string, RealSlot>,
): Map<string, Resolved> {
  const res = new Map<string, Resolved>()

  const sideTeam = (source: SlotSource | undefined): string | null => {
    if (!source) return null
    const r = res.get(source.slot)
    if (!r || !r.advancerId) return null
    if (source.kind === 'winner') return r.advancerId
    return r.advancerId === r.localId ? r.visitanteId : r.localId
  }

  for (const { slots } of BRACKET_BY_ROUND) {
    for (const s of slots) {
      let localId: string | null
      let visitanteId: string | null
      if (!s.localSource) {
        const rm = realBySlot.get(s.slot)
        localId = rm?.localId ?? null
        visitanteId = rm?.visitanteId ?? null
      } else {
        localId = sideTeam(s.localSource)
        visitanteId = sideTeam(s.visitanteSource)
      }
      const want = picks[s.slot]?.advancer ?? null
      const advancerId = want && (want === localId || want === visitanteId) ? want : null
      res.set(s.slot, { localId, visitanteId, advancerId })
    }
  }
  return res
}

/** Etiqueta del "feeder" de un lado cuando el equipo aún no está definido. */
function feederLabel(
  slotDef: BracketSlot,
  side: 'local' | 'visitante',
  resolved: Map<string, Resolved>,
  teamsById: Map<string, TeamRef>,
): string {
  const src = side === 'local' ? slotDef.localSource : slotDef.visitanteSource
  const fallback = side === 'local' ? slotDef.localFeeder : slotDef.visitanteFeeder
  if (!src) return fallback
  const r = resolved.get(src.slot)
  const a = r?.localId ? teamsById.get(r.localId)?.nombre : null
  const b = r?.visitanteId ? teamsById.get(r.visitanteId)?.nombre : null
  const word = src.kind === 'winner' ? 'Ganador' : 'Perdedor'
  if (a && b) return `${word} ${a} / ${b}`
  return fallback
}

// ─── Sección de ronda (colapsable) ────────────────────────────

function RoundSection({
  round, slotDefs, definidos, roundOpen, now, deadlineMinutes,
  bracketActivatedAt, resolved, picks, teamsById, realBySlot, countBySlot,
  totalParticipantes, onPick,
}: {
  round: RoundKey
  slotDefs: BracketSlot[]
  definidos: number
  roundOpen: boolean
  now: number
  deadlineMinutes: number
  bracketActivatedAt: string | null
  resolved: Map<string, Resolved>
  picks: Record<string, PickState>
  teamsById: Map<string, TeamRef>
  realBySlot: Map<string, RealSlot>
  countBySlot: Map<string, number>
  totalParticipantes: number
  onPick: (slot: string, patch: Partial<PickState>) => void
}) {
  const [open, setOpen] = useState(round === 'dieciseisavos')

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1c2330] transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#e6edf3]">{ROUND_LABELS[round]}</span>
          {roundOpen && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#9EE637]/15 text-[#9EE637]">
              Abierto
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-[#768390]">
          <span className="text-xs tabular-nums">{definidos}/{slotDefs.length}</span>
          <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        </span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {slotDefs.map((slotDef, i) => (
            <SlotCard
              key={slotDef.slot}
              slotDef={slotDef}
              matchNo={i + 1}
              roundLabel={ROUND_LABELS[round]}
              roundOpen={roundOpen}
              now={now}
              deadlineMinutes={deadlineMinutes}
              bracketActivatedAt={bracketActivatedAt}
              res={resolved.get(slotDef.slot)}
              resolved={resolved}
              pick={picks[slotDef.slot]}
              real={realBySlot.get(slotDef.slot)}
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
  slotDef, matchNo, roundLabel, roundOpen, now, deadlineMinutes, bracketActivatedAt,
  res, resolved, pick, real, teamsById, predCount, totalParticipantes, onPick,
}: {
  slotDef: BracketSlot
  matchNo: number
  roundLabel: string
  roundOpen: boolean
  now: number
  deadlineMinutes: number
  bracketActivatedAt: string | null
  res: Resolved | undefined
  resolved: Map<string, Resolved>
  pick: PickState | undefined
  real: RealSlot | undefined
  teamsById: Map<string, TeamRef>
  predCount: number
  totalParticipantes: number
  onPick: (slot: string, patch: Partial<PickState>) => void
}) {
  const slot = slotDef.slot
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  const localId = res?.localId ?? null
  const visitanteId = res?.visitanteId ?? null
  const advancerId = res?.advancerId ?? null
  const localName = localId ? teamsById.get(localId)?.nombre ?? '—' : null
  const visitanteName = visitanteId ? teamsById.get(visitanteId)?.nombre ?? '—' : null
  const bothKnown = !!localId && !!visitanteId

  const finished = real?.estado === 'finished'
  const live = real?.estado === 'live'
  const hasResult = real?.golesLocal != null && real?.golesVisitante != null

  const deadlineMs = real?.kickoffAt ? new Date(real.kickoffAt).getTime() - deadlineMinutes * 60_000 : null
  const participates =
    !real?.kickoffAt || !bracketActivatedAt ||
    new Date(real.kickoffAt).getTime() >= new Date(bracketActivatedAt).getTime()
  const windowOpen = real
    ? real.estado === 'scheduled' && participates && (deadlineMs === null || now < deadlineMs)
    : true
  const editable = roundOpen && windowOpen

  async function persist(advancer: string | null, local: string, visitante: string) {
    setStatus('saving'); setMsg('')
    const pl = local !== '' ? parseInt(local, 10) : null
    const pv = visitante !== '' ? parseInt(visitante, 10) : null
    const r = await saveBracketSlot(slot, advancer, pl, pv)
    if (r.ok) { setStatus('saved'); setMsg('Guardado ✓') }
    else { setStatus('error'); setMsg(r.error ?? 'Error') }
  }

  function chooseWinner(teamId: string) {
    if (!editable) return
    onPick(slot, { advancer: teamId })
    void persist(teamId, pick?.local ?? '', pick?.visitante ?? '')
  }
  function saveAll() {
    void persist(pick?.advancer ?? null, pick?.local ?? '', pick?.visitante ?? '')
  }

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5">
      {/* Header compacto */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[#768390]">{roundLabel} · Partido {matchNo}</span>
        <StatusPill editable={editable} finished={finished} live={live} />
      </div>

      {bothKnown ? (
        <div className="space-y-1.5">
          <TeamRow
            name={localName!} selected={advancerId === localId} editable={editable}
            score={pick?.local ?? ''} result={hasResult ? real!.golesLocal : null}
            onPick={() => chooseWinner(localId!)}
            onScore={(v) => onPick(slot, { local: v })}
          />
          <TeamRow
            name={visitanteName!} selected={advancerId === visitanteId} editable={editable}
            score={pick?.visitante ?? ''} result={hasResult ? real!.golesVisitante : null}
            onPick={() => chooseWinner(visitanteId!)}
            onScore={(v) => onPick(slot, { visitante: v })}
          />
        </div>
      ) : (
        // Cruce aún no definido: mostrar de dónde sale cada equipo
        <div className="space-y-1 py-0.5">
          <FeederRow label={localName ?? feederLabel(slotDef, 'local', resolved, teamsById)} known={!!localName} />
          <FeederRow label={visitanteName ?? feederLabel(slotDef, 'visitante', resolved, teamsById)} known={!!visitanteName} />
        </div>
      )}

      {/* Pie: cierre + guardar / resultado */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-[#768390] truncate">
          {finished && hasResult ? (
            <span className="text-[#58a6ff]">Final · {real!.golesLocal}–{real!.golesVisitante}</span>
          ) : live && hasResult ? (
            <span className="text-[#f85149]">🔴 {real!.golesLocal}–{real!.golesVisitante}</span>
          ) : editable && deadlineMs !== null ? (
            <>Cierra {fmtClose(new Date(deadlineMs).toISOString())}</>
          ) : !bothKnown ? (
            'Define la ronda anterior ↑'
          ) : null}
        </span>
        {bothKnown && editable && (
          <button
            onClick={saveAll}
            disabled={status === 'saving'}
            className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
          >
            {status === 'saving' ? '…' : 'Guardar'}
          </button>
        )}
      </div>

      {msg && (
        <p className={`text-[10px] mt-1 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</p>
      )}
      {predCount > 0 && (
        <p className="text-[10px] text-[#768390] mt-1">📊 {predCount}/{totalParticipantes} predicciones</p>
      )}
    </div>
  )
}

/** Fila de un equipo: nombre (toca = avanza) + input de marcador. */
function TeamRow({
  name, selected, editable, score, result, onPick, onScore,
}: {
  name: string
  selected: boolean
  editable: boolean
  score: string
  result: number | null
  onPick: () => void
  onScore: (v: string) => void
}) {
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
      selected ? 'border-[#9EE637] bg-[#9EE637]/10' : 'border-[#30363d] bg-[#161b22]'
    }`}>
      <button
        onClick={onPick}
        disabled={!editable}
        className={`flex items-center gap-2 min-w-0 flex-1 text-left ${editable ? '' : 'cursor-default'}`}
        title={editable ? 'Toca para marcar que avanza' : undefined}
      >
        <TeamFlag nombre={name} size={18} />
        <span className={`text-sm font-semibold truncate ${selected ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
          {name}
        </span>
        {selected && <span className="text-[#9EE637] text-xs shrink-0">✓ avanza</span>}
      </button>
      {editable ? (
        <input
          type="number" min={0} max={99} inputMode="numeric"
          value={score}
          onChange={(e) => onScore(e.target.value)}
          placeholder="–"
          className="w-11 px-1 py-1 text-center text-base font-bold rounded bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
        />
      ) : (
        <span className="w-11 text-center text-base font-black tabular-nums text-[#768390]">
          {score === '' ? '–' : score}
        </span>
      )}
      {result !== null && (
        <span className="text-xs text-[#58a6ff] tabular-nums w-4 text-center" title="Resultado oficial">{result}</span>
      )}
    </div>
  )
}

/** Fila de un equipo aún no definido (muestra el feeder). */
function FeederRow({ label, known }: { label: string; known: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-[#30363d] bg-[#0d1117] px-2 py-1.5">
      <span className="text-[#768390] text-xs shrink-0">{known ? '' : '🏆'}</span>
      <span className={`text-sm truncate ${known ? 'text-[#e6edf3] font-semibold' : 'text-[#768390]'}`}>{label}</span>
    </div>
  )
}

function StatusPill({
  editable, finished, live,
}: { editable: boolean; finished: boolean; live: boolean }) {
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
