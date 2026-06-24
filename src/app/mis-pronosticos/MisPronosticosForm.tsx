'use client'

import { useEffect, useState } from 'react'
import { savePrediction } from './actions'

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
}

export function fmtKickoff(iso: string | null): string {
  if (!iso) return 'Por definir'
  return new Date(iso).toLocaleString('es-CO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Fila de un partido de eliminación con equipos ya conocidos.
 * `editable` lo controla la ronda: si la fase no está habilitada, nunca se
 * muestran inputs aunque el deadline siga abierto (se ve marcador/pronóstico).
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

  // Solo se puede pronosticar si la ronda está habilitada Y la ventana abierta
  const isOpen = editable && windowOpen

  async function handleSave() {
    const pl = parseInt(local, 10)
    const pv = parseInt(visitante, 10)
    if (isNaN(pl) || isNaN(pv)) { setStatus('error'); setMsg('Completa ambos marcadores'); return }
    setStatus('saving'); setMsg('')
    const res = await savePrediction(match.id, pl, pv)
    if (res.ok) { setStatus('saved'); setMsg('Guardado ✓') }
    else { setStatus('error'); setMsg(res.error ?? 'Error') }
  }

  const finished = match.estado === 'finished'
  const hasPred = match.predLocal !== null && match.predVisitante !== null
  const finalLabel = finished && match.golesLocal !== null && match.golesVisitante !== null
    ? `Final ${match.golesLocal}–${match.golesVisitante}`
    : 'Final'

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="text-[#768390] uppercase tracking-wide">{match.fase}</span>
        <span className="text-[#768390]">{fmtKickoff(match.kickoffAt)}</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-[#e6edf3] flex-1 text-right truncate">
          {match.localNombre}
        </span>

        {isOpen ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="number" min={0} max={99} inputMode="numeric"
              value={local} onChange={(e) => setLocal(e.target.value)}
              className="w-12 px-2 py-1.5 text-center rounded-md bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            />
            <span className="text-[#768390]">–</span>
            <input
              type="number" min={0} max={99} inputMode="numeric"
              value={visitante} onChange={(e) => setVisitante(e.target.value)}
              className="w-12 px-2 py-1.5 text-center rounded-md bg-[#0d1117] border border-[#30363d] text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            />
          </div>
        ) : (
          <span className="text-sm font-mono text-[#768390] shrink-0 w-16 text-center">
            {hasPred ? `${match.predLocal} – ${match.predVisitante}` : 'sin pronóstico'}
          </span>
        )}

        <span className="text-sm font-semibold text-[#e6edf3] flex-1 truncate">
          {match.visitanteNombre}
        </span>
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          isOpen ? 'bg-[#9EE637]/15 text-[#9EE637]'
          : finished ? 'bg-[#58a6ff]/15 text-[#58a6ff]'
          : 'bg-[#f85149]/15 text-[#f85149]'
        }`}>
          {isOpen ? closeLabel : finished ? finalLabel : '🔒 Cerrado'}
        </span>

        {isOpen && (
          <button
            onClick={handleSave}
            disabled={status === 'saving'}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
          >
            {status === 'saving' ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>

      {msg && (
        <p className={`text-xs mt-2 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</p>
      )}
    </div>
  )
}
