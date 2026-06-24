'use client'

import { useState } from 'react'
import { KnockoutRow, fmtKickoff, type KnockoutMatch } from './MisPronosticosForm'
import { ROUND_LABELS, type RoundKey } from '@/config/bracket2026'

export interface BracketSlotItem {
  slot: string
  localFeeder: string
  visitanteFeeder: string
  match: KnockoutMatch | null // partido real si ya existe en la DB
}

export interface BracketRound {
  round: RoundKey
  slots: BracketSlotItem[]
}

export default function BracketView({
  rounds,
  openRounds,
  deadlineMinutes,
}: {
  rounds: BracketRound[]
  openRounds: string[]
  deadlineMinutes: number
}) {
  return (
    <div className="space-y-3">
      {rounds.map((r) => (
        <RoundSection
          key={r.round}
          round={r}
          editable={openRounds.includes(r.round)}
          deadlineMinutes={deadlineMinutes}
        />
      ))}
    </div>
  )
}

function RoundSection({
  round,
  editable,
  deadlineMinutes,
}: {
  round: BracketRound
  editable: boolean
  deadlineMinutes: number
}) {
  // 16avos abierto al inicio; el resto colapsado para no abrumar en móvil.
  const [open, setOpen] = useState(round.round === 'dieciseisavos')
  const definidos = round.slots.filter((s) => s.match).length

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1c2330] transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#e6edf3]">{ROUND_LABELS[round.round]}</span>
          {editable && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#9EE637]/15 text-[#9EE637]">
              Abierto
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-[#768390]">
          <span className="text-xs tabular-nums">{definidos}/{round.slots.length}</span>
          <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {round.slots.map((s) =>
            s.match ? (
              <KnockoutRow
                key={s.slot}
                match={s.match}
                deadlineMinutes={deadlineMinutes}
                editable={editable}
              />
            ) : (
              <PlaceholderRow key={s.slot} slot={s} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

/** Slot sin equipos definidos todavía: muestra los "feeders" de la plantilla. */
function PlaceholderRow({ slot }: { slot: BracketSlotItem }) {
  return (
    <div className="bg-[#0d1117] border border-dashed border-[#30363d] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-[#768390] uppercase tracking-wide">{slot.slot}</span>
        <span className="text-[#768390]">{fmtKickoff(null)}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-[#768390] flex-1 text-right truncate">{slot.localFeeder}</span>
        <span className="text-xs text-[#484f58] shrink-0 w-16 text-center">vs</span>
        <span className="text-sm text-[#768390] flex-1 truncate">{slot.visitanteFeeder}</span>
      </div>
      <div className="mt-3">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#30363d] text-[#768390]">
          Por definir
        </span>
      </div>
    </div>
  )
}
