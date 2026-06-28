'use client'

import { useEffect, useState } from 'react'
import { savePrediction } from './actions'
import TeamFlag from '@/components/ui/TeamFlag'
import { ROUND_LABELS, type RoundKey } from '@/config/bracket2026'

export interface KnockoutMatch {
  id: string
  fase: string
  kickoffAt: string | null
  estado: string
  localNombre: string
  visitanteNombre: string
  golesLocal: number | null
  golesVisitante: number | null
  predLocal: number | null
  predVisitante: number | null
  predCount?: number
  totalParticipants?: number
}

const TZ = 'America/Bogota'

export function fmtKickoff(iso: string | null): string {
  if (!iso) return 'Por definir'
  return new Date(iso).toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: TZ,
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })
}

function roundLabel(fase: string): string {
  return ROUND_LABELS[fase as RoundKey] ?? fase
}

/**
 * Tarjeta de un partido de eliminación con equipos ya conocidos (estilo picks4all,
 * tema oscuro). `editable` lo controla la ronda; si la fase no está habilitada,
 * nunca se muestran inputs aunque el deadline siga abierto.
 */
export function KnockoutRow({
  match,
  deadlineMinutes,
  editable = true,
}: {
  match: KnockoutMatch
  deadlineMinutes: number
  editable?: boolean
}) {
  const [local, setLocal] = useState(match.predLocal?.toString() ?? '')
  const [visitante, setVisitante] = useState(match.predVisitante?.toString() ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [closeLabel, setCloseLabel] = useState<string>('')
  const [windowOpen, setWindowOpen] = useState(false)
  // Por defecto la predicción se muestra read-only; "Modificar" revela los inputs
  const [editing, setEditing] = useState(false)

  const deadlineMs = match.kickoffAt
    ? new Date(match.kickoffAt).getTime() - deadlineMinutes * 60_000
    : null

  // Countdown + estado abierto/cerrado en tiempo real
  useEffect(() => {
    if (deadlineMs === null || match.estado !== 'scheduled') {
      setWindowOpen(false)
      return
    }
    const tick = () => {
      const diff = deadlineMs - Date.now()
      if (diff <= 0) { setWindowOpen(false); setCloseLabel('Cerrado'); return }
      setWindowOpen(true)
      const h = Math.floor(diff / 3_600_000)
      const min = Math.floor((diff % 3_600_000) / 60_000)
      setCloseLabel(h > 0 ? `Cierra en ${h}h ${min}m` : `Cierra en ${min}m`)
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [deadlineMs, match.estado])

  const isOpen = editable && windowOpen
  const finished = match.estado === 'finished'
  const live = match.estado === 'live'
  const hasPred = match.predLocal !== null && match.predVisitante !== null
  const hasResult = match.golesLocal !== null && match.golesVisitante !== null

  async function handleSave() {
    const pl = parseInt(local, 10)
    const pv = parseInt(visitante, 10)
    if (isNaN(pl) || isNaN(pv)) { setStatus('error'); setMsg('Completa ambos marcadores'); return }
    setStatus('saving'); setMsg('')
    const res = await savePrediction(match.id, pl, pv)
    if (res.ok) { setStatus('saved'); setMsg('Guardado ✓'); setEditing(false) }
    else { setStatus('error'); setMsg(res.error ?? 'Error') }
  }

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-xl overflow-hidden">
      {/* Header: equipos + pill de estado */}
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TeamFlag nombre={match.localNombre} size={20} />
            <span className="text-sm font-semibold text-[#e6edf3] truncate">{match.localNombre}</span>
            <span className="text-xs text-[#768390] shrink-0 px-1">vs</span>
            <span className="text-sm font-semibold text-[#e6edf3] truncate">{match.visitanteNombre}</span>
            <TeamFlag nombre={match.visitanteNombre} size={20} />
          </div>
          <StatusPill isOpen={isOpen} finished={finished} live={live} closeLabel={closeLabel} />
        </div>

        <div className="mt-1.5 text-[11px] text-[#768390]">
          {roundLabel(match.fase)}
          {match.kickoffAt && <> · Inicio: {fmtKickoff(match.kickoffAt)}</>}
        </div>
        {isOpen && deadlineMs !== null && (
          <div className="text-[11px] text-[#f85149] mt-0.5">
            Cierre de predicciones: {fmtTime(new Date(deadlineMs).toISOString())} (hora Colombia)
          </div>
        )}
      </div>

      {/* Mi Predicción */}
      <div className="px-3.5 pb-3.5">
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wide text-[#768390] mb-2">Mi Predicción</div>

          {isOpen && editing ? (
            <div className="flex items-center justify-center gap-2">
              <TeamFlag nombre={match.localNombre} size={22} />
              <input
                type="number" min={0} max={99} inputMode="numeric"
                value={local} onChange={(e) => setLocal(e.target.value)}
                className="w-14 px-2 py-2 text-center text-lg font-bold rounded-md bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
              />
              <span className="text-[#768390] font-bold">–</span>
              <input
                type="number" min={0} max={99} inputMode="numeric"
                value={visitante} onChange={(e) => setVisitante(e.target.value)}
                className="w-14 px-2 py-2 text-center text-lg font-bold rounded-md bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
              />
              <TeamFlag nombre={match.visitanteNombre} size={22} />
              <button
                onClick={handleSave}
                disabled={status === 'saving'}
                className="ml-2 text-xs font-semibold px-3 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
              >
                {status === 'saving' ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <TeamFlag nombre={match.localNombre} size={24} />
              <span className="text-2xl font-black tabular-nums text-[#e6edf3]">
                {hasPred ? match.predLocal : '–'}
              </span>
              <span className="text-[#768390] font-bold">–</span>
              <span className="text-2xl font-black tabular-nums text-[#e6edf3]">
                {hasPred ? match.predVisitante : '–'}
              </span>
              <TeamFlag nombre={match.visitanteNombre} size={24} />
              {isOpen && (
                <button
                  onClick={() => setEditing(true)}
                  className="ml-2 text-xs font-semibold px-3 py-1.5 rounded-md border border-[#30363d] text-[#e6edf3] hover:border-[#9EE637]/50 hover:text-[#9EE637] transition-colors"
                >
                  ✏️ {hasPred ? 'Modificar' : 'Predecir'}
                </button>
              )}
            </div>
          )}

          {!isOpen && !hasPred && (
            <p className="text-center text-xs text-[#768390] mt-1">Sin pronóstico</p>
          )}
          {msg && (
            <p className={`text-xs text-center mt-2 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</p>
          )}
        </div>

        {/* Resultado */}
        <div className="mt-2.5 bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-center">
          <div className="text-[10px] uppercase tracking-wide text-[#768390] mb-1">Resultado</div>
          {hasResult ? (
            <div className="text-lg font-bold tabular-nums text-[#9EE637]">
              {live && '🔴 '}{match.golesLocal} – {match.golesVisitante}
              {finished && <span className="text-[#768390] text-xs font-normal"> · Final</span>}
            </div>
          ) : (
            <div>
              <div className="text-2xl">⏳</div>
              <div className="text-xs font-medium text-[#768390]">Resultado pendiente</div>
              <div className="text-[10px] text-[#484f58]">Se actualizará automáticamente al finalizar el partido</div>
            </div>
          )}
        </div>

        {/* Contador de pronósticos */}
        {match.predCount !== undefined && match.totalParticipants !== undefined && (
          <div className="mt-2.5 flex justify-center">
            <span className="text-[11px] text-[#768390] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#30363d]">
              📊 {match.predCount}/{match.totalParticipants} predicciones
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusPill({
  isOpen, finished, live, closeLabel,
}: { isOpen: boolean; finished: boolean; live: boolean; closeLabel: string }) {
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
  if (isOpen) {
    return (
      <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#9EE637]/15 text-[#9EE637]" title={closeLabel}>
        ✅ OPEN
      </span>
    )
  }
  return <span className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full bg-[#768390]/15 text-[#768390]">🔒 Cerrado</span>
}
