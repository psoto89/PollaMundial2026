'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BRACKET_2026, ROUND_ORDER, ROUND_LABELS, type RoundKey } from '@/config/bracket2026'

export interface TeamOption {
  id: string
  nombre: string
}

export interface ExistingMatch {
  id: string
  fase: string
  bracketSlot: string | null
  kickoffAt: string | null
  estado: string
  local: string
  visitante: string
}

const FASES = ROUND_ORDER

export default function BracketForm({
  teams,
  existing,
  usedSlots,
  openRounds,
  bracketActivatedAt,
}: {
  teams: TeamOption[]
  existing: ExistingMatch[]
  usedSlots: string[]
  openRounds: string[]
  bracketActivatedAt: string | null
}) {
  const router = useRouter()
  const [fase, setFase] = useState<RoundKey>('dieciseisavos')
  const [slot, setSlot] = useState('')
  const [localId, setLocalId] = useState('')
  const [visitanteId, setVisitanteId] = useState('')
  const [kickoff, setKickoff] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  // Slots de la fase elegida que todavía no se han usado
  const slotOptions = useMemo(
    () => BRACKET_2026.filter((s) => s.round === fase && !usedSlots.includes(s.slot)),
    [fase, usedSlots],
  )

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
          kickoffAt: new Date(kickoff).toISOString(),
          bracketSlot: slot || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus('idle'); setMsg('')
        setLocalId(''); setVisitanteId(''); setKickoff(''); setSlot('')
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
      {/* Activación de la polla ("desde hoy hacia adelante") */}
      <ActivationControl initial={bracketActivatedAt} />

      {/* Habilitar pronóstico por ronda */}
      <RoundsToggle initial={openRounds} />

      {/* Crear los 16avos automáticamente desde las posiciones de grupos */}
      <SeedR32 />


      {/* Crear partido */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[#e6edf3]">Nuevo partido</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-[#768390]">
            Fase
            <select
              value={fase}
              onChange={(e) => { setFase(e.target.value as RoundKey); setSlot('') }}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            >
              {FASES.map((f) => <option key={f} value={f}>{ROUND_LABELS[f]}</option>)}
            </select>
          </label>

          <label className="text-xs text-[#768390]">
            Slot del bracket
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            >
              <option value="">— sin asignar —</option>
              {slotOptions.map((s) => (
                <option key={s.slot} value={s.slot}>
                  {s.slot} · {s.localFeeder} vs {s.visitanteFeeder}
                </option>
              ))}
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

          <div className="hidden sm:block" />

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
                <span className="text-[#e6edf3]">
                  {m.bracketSlot && <span className="text-[#768390] mr-2">[{m.bracketSlot}]</span>}
                  {m.local} vs {m.visitante}
                </span>
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

/** Crea los 16 partidos de 16avos automáticamente desde las posiciones de grupos. */
function SeedR32() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [msg, setMsg] = useState('')

  async function seed() {
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/bracket/seed', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMsg(`✅ ${data.created} creados · ${data.skipped} ya existían${data.missing?.length ? ` · ${data.missing.length} sin equipos aún` : ''}`)
        router.refresh()
      } else {
        setMsg(`❌ ${data.error ?? 'Error'}`)
      }
    } catch {
      setMsg('❌ Error de red')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#e6edf3]">Crear 16avos automáticamente</h2>
        <p className="text-xs text-[#768390] mt-1">
          Arma los 16 partidos de la primera ronda con los 1º/2º de cada grupo y los 8 mejores
          terceros (según las posiciones actuales). Salta los que ya existan. Ajusta kickoffs/equipos
          luego si hace falta.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={seed}
          disabled={status === 'saving'}
          className="text-sm font-semibold px-4 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
        >
          {status === 'saving' ? 'Creando…' : 'Crear 16avos'}
        </button>
        {msg && <span className="text-xs text-[#768390]">{msg}</span>}
      </div>
    </div>
  )
}

/**
 * Marca de activación de la polla. Solo participan/puntúan los partidos cuyo kickoff
 * sea posterior a esta fecha; los ya iniciados al activar quedan cerrados ("desde hoy
 * hacia adelante"). app_config.bracket_activated_at.
 */
function ActivationControl({ initial }: { initial: string | null }) {
  const router = useRouter()
  // ISO → valor para <input datetime-local> en hora local
  const toLocalInput = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    const off = d.getTimezoneOffset() * 60_000
    return new Date(d.getTime() - off).toISOString().slice(0, 16)
  }
  const [value, setValue] = useState<string>(toLocalInput(initial))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function patch(bracketActivatedAt: string | null, okMsg: string) {
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/bracket', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bracketActivatedAt }),
      })
      const data = await res.json()
      if (res.ok) { setStatus('saved'); setMsg(okMsg); router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#e6edf3]">Activación de la polla</h2>
        <p className="text-xs text-[#768390] mt-1">
          Solo participan los partidos que arranquen <strong>después</strong> de esta fecha. Los ya
          iniciados al activar quedan cerrados y no otorgan puntos. Vacío = todos participan.
        </p>
        <p className="text-xs text-[#768390] mt-1">
          Actual: <span className="text-[#e6edf3]">{initial ? new Date(initial).toLocaleString('es-CO') : '— sin activación —'}</span>
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
        />
        <button
          onClick={() => value && patch(new Date(value).toISOString(), 'Activación guardada ✓')}
          disabled={status === 'saving' || !value}
          className="text-sm font-semibold px-4 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
        >
          {status === 'saving' ? 'Guardando…' : 'Activar desde'}
        </button>
        <button
          onClick={() => { setValue(''); patch(null, 'Activación quitada ✓') }}
          disabled={status === 'saving'}
          className="text-sm font-medium px-3 py-2 rounded-md border border-[#30363d] text-[#768390] hover:text-[#e6edf3] disabled:opacity-50"
        >
          Quitar
        </button>
        {msg && (
          <span className={`text-xs ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</span>
        )}
      </div>
    </div>
  )
}

/** Checkboxes para abrir/cerrar el pronóstico de cada ronda (app_config.open_rounds). */
function RoundsToggle({ initial }: { initial: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState<Set<string>>(new Set(initial))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  function toggle(f: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
    setStatus('idle')
  }

  async function save() {
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/bracket', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRounds: ROUND_ORDER.filter((f) => open.has(f)) }),
      })
      const data = await res.json()
      if (res.ok) { setStatus('saved'); setMsg('Guardado ✓'); router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#e6edf3]">Habilitar pronóstico por ronda</h2>
        <p className="text-xs text-[#768390] mt-1">
          Las rondas marcadas dejan que la gente cargue su marcador (hasta 1h antes de cada partido).
          Las demás se ven pero quedan bloqueadas.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ROUND_ORDER.map((f) => {
          const active = open.has(f)
          return (
            <button
              key={f}
              onClick={() => toggle(f)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
                active
                  ? 'bg-[#9EE637]/15 border-[#9EE637]/40 text-[#9EE637]'
                  : 'bg-[#0d1117] border-[#30363d] text-[#768390]'
              }`}
            >
              {ROUND_LABELS[f]}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={status === 'saving'}
          className="text-sm font-semibold px-4 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50"
        >
          {status === 'saving' ? 'Guardando…' : 'Guardar rondas'}
        </button>
        {msg && (
          <span className={`text-xs ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</span>
        )}
      </div>
    </div>
  )
}
