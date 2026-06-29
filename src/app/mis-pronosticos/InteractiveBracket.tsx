'use client'

import { useEffect, useMemo, useState } from 'react'
import TeamFlag from '@/components/ui/TeamFlag'
import { saveBracketSlot } from './actions'
import {
  BRACKET_BY_ROUND,
  ROUND_LABELS,
  type RoundKey,
  type SlotSource,
} from '@/config/bracket2026'

const TZ = 'America/Bogota'

export interface TeamRef {
  id: string
  nombre: string
}

// Partido real que se superpone a un slot (R32 trae equipos reales; rondas
// posteriores pueden no existir hasta que el admin las cree).
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
  local: string // marcador como string (input)
  visitante: string
}

// ─── Helpers de fecha ─────────────────────────────────────────

function fmtKickoff(iso: string | null): string {
  if (!iso) return 'Por definir'
  return new Date(iso).toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
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

  // Estado de picks por slot. Inicializado desde mis predicciones; los slots ya
  // decididos que no pronostiqué se siembran con el clasificado OFICIAL para que
  // el cuadro fluya (sin guardar nada: esos slots están cerrados).
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

  // Tic global para recalcular deadlines sin un efecto por tarjeta.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Resolución del cuadro: equipos de cada slot + el clasificado validado.
  const resolved = useMemo(() => resolveBracket(picks, realBySlot), [picks, realBySlot])

  function setPick(slot: string, patch: Partial<PickState>) {
    setPicks((prev) => {
      const base: PickState = prev[slot] ?? { advancer: null, local: '', visitante: '' }
      return { ...prev, [slot]: { ...base, ...patch } }
    })
  }

  return (
    <div className="space-y-3">
      {BRACKET_BY_ROUND.map(({ round, slots }) => {
        const definidos = slots.filter((s) => resolved.get(s.slot)?.advancerId).length
        return (
          <RoundSection
            key={round}
            round={round}
            slotKeys={slots.map((s) => s.slot)}
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

interface Resolved {
  localId: string | null
  visitanteId: string | null
  advancerId: string | null
}

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
    // 'loser': el otro equipo del slot fuente
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
      // Solo es válido si el equipo elegido sigue siendo uno de los dos del slot;
      // si cambió por un pick aguas arriba, se invalida (limpia el avance).
      const advancerId = want && (want === localId || want === visitanteId) ? want : null
      res.set(s.slot, { localId, visitanteId, advancerId })
    }
  }
  return res
}

// ─── Sección de ronda (colapsable) ────────────────────────────

function RoundSection({
  round, slotKeys, definidos, roundOpen, now, deadlineMinutes,
  bracketActivatedAt, resolved, picks, teamsById, realBySlot, countBySlot,
  totalParticipantes, onPick,
}: {
  round: RoundKey
  slotKeys: string[]
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
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1c2330] transition-colors"
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
          <span className="text-xs tabular-nums">{definidos}/{slotKeys.length}</span>
          <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {slotKeys.map((slot) => (
            <SlotCard
              key={slot}
              slot={slot}
              roundOpen={roundOpen}
              now={now}
              deadlineMinutes={deadlineMinutes}
              bracketActivatedAt={bracketActivatedAt}
              res={resolved.get(slot)}
              pick={picks[slot]}
              real={realBySlot.get(slot)}
              teamsById={teamsById}
              predCount={countBySlot.get(slot) ?? 0}
              totalParticipantes={totalParticipantes}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tarjeta de un slot ───────────────────────────────────────

function SlotCard({
  slot, roundOpen, now, deadlineMinutes, bracketActivatedAt, res, pick, real,
  teamsById, predCount, totalParticipantes, onPick,
}: {
  slot: string
  roundOpen: boolean
  now: number
  deadlineMinutes: number
  bracketActivatedAt: string | null
  res: Resolved | undefined
  pick: PickState | undefined
  real: RealSlot | undefined
  teamsById: Map<string, TeamRef>
  predCount: number
  totalParticipantes: number
  onPick: (slot: string, patch: Partial<PickState>) => void
}) {
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

  // ¿Editable? Espejo de is_bracket_slot_open: ronda abierta + (sin partido real →
  // abierto) o (programado, antes del deadline, y participa de la activación).
  const deadlineMs = real?.kickoffAt ? new Date(real.kickoffAt).getTime() - deadlineMinutes * 60_000 : null
  const participates =
    !real?.kickoffAt || !bracketActivatedAt ||
    new Date(real.kickoffAt).getTime() >= new Date(bracketActivatedAt).getTime()
  const windowOpen = real
    ? real.estado === 'scheduled' && participates && (deadlineMs === null || now < deadlineMs)
    : true
  const editable = roundOpen && windowOpen

  const closeLabel = deadlineMs && editable
    ? (() => {
        const diff = deadlineMs - now
        const h = Math.floor(diff / 3_600_000)
        const m = Math.floor((diff % 3_600_000) / 60_000)
        return h > 0 ? `Cierra en ${h}h ${m}m` : `Cierra en ${m}m`
      })()
    : ''

  async function persist(advancer: string | null, local: string, visitante: string) {
    setStatus('saving'); setMsg('')
    const pl = local !== '' ? parseInt(local, 10) : null
    const pv = visitante !== '' ? parseInt(visitante, 10) : null
    const res = await saveBracketSlot(slot, advancer, pl, pv)
    if (res.ok) { setStatus('saved'); setMsg('Guardado ✓') }
    else { setStatus('error'); setMsg(res.error ?? 'Error') }
  }

  // Tocar un equipo = elegirlo como el que avanza (auto-guarda con el marcador actual)
  function chooseWinner(teamId: string) {
    if (!editable) return
    onPick(slot, { advancer: teamId })
    void persist(teamId, pick?.local ?? '', pick?.visitante ?? '')
  }

  function saveScore() {
    void persist(pick?.advancer ?? null, pick?.local ?? '', pick?.visitante ?? '')
  }

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-xl overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-[#768390] uppercase tracking-wide">{slot}</span>
          <StatusPill editable={editable} finished={finished} live={live} closeLabel={closeLabel} />
        </div>

        {bothKnown ? (
          <>
            {/* Selección de quién avanza (toca un equipo) */}
            <div className="grid grid-cols-2 gap-2">
              <TeamChoice
                name={localName!} selected={advancerId === localId}
                editable={editable} onClick={() => chooseWinner(localId!)}
              />
              <TeamChoice
                name={visitanteName!} selected={advancerId === visitanteId}
                editable={editable} onClick={() => chooseWinner(visitanteId!)}
              />
            </div>

            {/* Marcador 90' */}
            <div className="mt-3 bg-[#161b22] border border-[#30363d] rounded-lg p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-[#768390] mb-1.5 text-center">
                Marcador (90&apos;)
              </div>
              <div className="flex items-center justify-center gap-2">
                <TeamFlag nombre={localName} size={20} />
                <ScoreInput
                  value={pick?.local ?? ''} editable={editable}
                  onChange={(v) => onPick(slot, { local: v })}
                />
                <span className="text-[#768390] font-bold">–</span>
                <ScoreInput
                  value={pick?.visitante ?? ''} editable={editable}
                  onChange={(v) => onPick(slot, { visitante: v })}
                />
                <TeamFlag nombre={visitanteName} size={20} />
                {editable && (
                  <button
                    onClick={saveScore}
                    disabled={status === 'saving'}
                    className="ml-1 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
                  >
                    {status === 'saving' ? '…' : 'Guardar'}
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-xs text-[#768390] py-3">
            Elige primero el ganador de la ronda anterior.
          </div>
        )}

        {editable && deadlineMs !== null && (
          <div className="text-[11px] text-[#f85149] mt-2">
            Cierre: {fmtTime(new Date(deadlineMs).toISOString())} (hora Colombia)
          </div>
        )}
        {real?.kickoffAt && (
          <div className="text-[11px] text-[#768390] mt-1">Inicio: {fmtKickoff(real.kickoffAt)}</div>
        )}

        {/* Resultado oficial */}
        {(hasResult || finished || live) && (
          <div className="mt-2.5 bg-[#161b22] border border-[#30363d] rounded-lg p-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-[#768390] mb-0.5">Resultado</div>
            {hasResult ? (
              <div className="text-base font-bold tabular-nums text-[#9EE637]">
                {live && '🔴 '}{real!.golesLocal} – {real!.golesVisitante}
                {finished && <span className="text-[#768390] text-xs font-normal"> · Final</span>}
              </div>
            ) : (
              <div className="text-xs text-[#768390]">Pendiente</div>
            )}
          </div>
        )}

        {msg && (
          <p className={`text-xs text-center mt-2 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</p>
        )}

        {predCount > 0 && (
          <div className="mt-2 flex justify-center">
            <span className="text-[11px] text-[#768390] inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#30363d]">
              📊 {predCount}/{totalParticipantes} predicciones
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function TeamChoice({
  name, selected, editable, onClick,
}: { name: string; selected: boolean; editable: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!editable}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${
        selected
          ? 'border-[#9EE637] bg-[#9EE637]/10'
          : 'border-[#30363d] bg-[#161b22] hover:border-[#9EE637]/40'
      } ${editable ? '' : 'opacity-80 cursor-default'}`}
    >
      <TeamFlag nombre={name} size={18} />
      <span className={`text-sm font-semibold truncate ${selected ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
        {name}
      </span>
      {selected && <span className="ml-auto text-[#9EE637] text-xs">✓</span>}
    </button>
  )
}

function ScoreInput({
  value, editable, onChange,
}: { value: string; editable: boolean; onChange: (v: string) => void }) {
  if (!editable) {
    return (
      <span className="w-12 text-center text-lg font-black tabular-nums text-[#e6edf3]">
        {value === '' ? '–' : value}
      </span>
    )
  }
  return (
    <input
      type="number" min={0} max={99} inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-12 px-1 py-1.5 text-center text-lg font-bold rounded-md bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
    />
  )
}

function StatusPill({
  editable, finished, live, closeLabel,
}: { editable: boolean; finished: boolean; live: boolean; closeLabel: string }) {
  if (live) {
    return (
      <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#f85149]/15 text-[#f85149] inline-flex items-center gap-1">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-[#f85149]" /> EN VIVO
      </span>
    )
  }
  if (finished) {
    return <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#58a6ff]/15 text-[#58a6ff]">Final</span>
  }
  if (editable) {
    return (
      <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#9EE637]/15 text-[#9EE637]" title={closeLabel}>
        ✅ OPEN
      </span>
    )
  }
  return <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#768390]/15 text-[#768390]">🔒 Cerrado</span>
}
