'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface TeamOption {
  id: string
  nombre: string
}

export interface ExistingMatch {
  id: string
  fase: string
  kickoffAt: string | null
  estado: string
  local: string
  visitante: string
}

const FASES = ['dieciseisavos', 'octavos', 'cuartos', 'semis', 'tercer_puesto', 'final'] as const

export default function BracketForm({
  teams,
  existing,
}: {
  teams: TeamOption[]
  existing: ExistingMatch[]
}) {
  const router = useRouter()
  const [fase, setFase] = useState<string>('dieciseisavos')
  const [localId, setLocalId] = useState('')
  const [visitanteId, setVisitanteId] = useState('')
  const [kickoff, setKickoff] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function create() {
    if (!localId || !visitanteId || !kickoff) {
      setStatus('error'); setMsg('Completa todos los campos'); return
    }
    if (localId === visitanteId) {
      setStatus('error'); setMsg('Los equipos deben ser distintos'); return
    }
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fase,
          equipoLocalId: localId,
          equipoVisitanteId: visitanteId,
          // datetime-local → ISO (el navegador lo da sin zona; lo enviamos tal cual + :00)
          kickoffAt: new Date(kickoff).toISOString(),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus('idle'); setMsg('')
        setLocalId(''); setVisitanteId(''); setKickoff('')
        router.refresh()
      } else {
        setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error')
      }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="space-y-6">
      {/* Crear partido */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[#e6edf3]">Nuevo partido</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-[#768390]">
            Fase
            <select
              value={fase}
              onChange={(e) => setFase(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            >
              {FASES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

          <label className="text-xs text-[#768390]">
            Kickoff (hora local)
            <input
              type="datetime-local"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            />
          </label>

          <label className="text-xs text-[#768390]">
            Local
            <select
              value={localId}
              onChange={(e) => setLocalId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            >
              <option value="">— elegir —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>

          <label className="text-xs text-[#768390]">
            Visitante
            <select
              value={visitanteId}
              onChange={(e) => setVisitanteId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            >
              <option value="">— elegir —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={create}
            disabled={status === 'saving'}
            className="text-sm font-semibold px-4 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
          >
            {status === 'saving' ? 'Creando…' : 'Crear partido'}
          </button>
          {msg && <span className="text-xs text-[#f85149]">{msg}</span>}
        </div>
      </div>

      {/* Partidos existentes */}
      <div>
        <h2 className="text-sm font-semibold text-[#e6edf3] mb-2">
          Partidos de eliminación ({existing.length})
        </h2>
        {existing.length === 0 ? (
          <p className="text-sm text-[#768390]">Aún no hay partidos de eliminación creados.</p>
        ) : (
          <div className="space-y-2">
            {existing.map((m) => (
              <div key={m.id} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex items-center justify-between text-sm">
                <span className="text-[#e6edf3]">{m.local} vs {m.visitante}</span>
                <span className="text-xs text-[#768390]">
                  {m.fase} · {m.kickoffAt ? new Date(m.kickoffAt).toLocaleString('es-CO') : 'sin fecha'} · {m.estado}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
