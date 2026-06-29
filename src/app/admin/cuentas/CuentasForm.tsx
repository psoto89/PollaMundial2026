'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ParticipantAccount {
  participantId: string
  nombre: string
  email: string
  vinculado: boolean
  selfJoin: boolean
}

export interface UnlinkedUser {
  authUserId: string
  email: string
  createdAt: string
}

export interface ParticipantOption {
  id: string
  nombre: string
}

export default function CuentasForm({
  rows,
  unlinkedUsers,
  participantOptions,
}: {
  rows: ParticipantAccount[]
  unlinkedUsers: UnlinkedUser[]
  participantOptions: ParticipantOption[]
}) {
  const selfJoinUsers = rows.filter((r) => r.selfJoin)
  const rosterRows = rows.filter((r) => !r.selfJoin)

  return (
    <div className="space-y-8">
      {/* Sección 0: usuarios self-service (entraron por el login) → se pueden borrar */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#e6edf3]">
          🧪 Usuarios self-service (login por correo)
          {selfJoinUsers.length > 0 && (
            <span className="ml-2 text-[10px] font-semibold bg-[#58a6ff]/15 text-[#58a6ff] px-1.5 py-0.5 rounded">
              {selfJoinUsers.length}
            </span>
          )}
        </h2>
        <p className="text-xs text-[#768390]">
          Cuentas creadas desde el login (no son del roster de la Etapa 1). Útil para borrar usuarios de prueba.
        </p>
        {selfJoinUsers.length === 0 ? (
          <p className="text-sm text-[#768390]">Ninguno todavía.</p>
        ) : (
          selfJoinUsers.map((r) => <DeleteRow key={r.participantId} row={r} />)
        )}
      </section>

      {/* Sección 1: cuentas nuevas sin vincular */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#e6edf3]">
          Cuentas nuevas sin vincular
          {unlinkedUsers.length > 0 && (
            <span className="ml-2 text-[10px] font-semibold bg-[#9EE637]/15 text-[#9EE637] px-1.5 py-0.5 rounded">
              {unlinkedUsers.length}
            </span>
          )}
        </h2>
        {unlinkedUsers.length === 0 ? (
          <p className="text-sm text-[#768390]">No hay cuentas nuevas pendientes de vincular.</p>
        ) : (
          unlinkedUsers.map((u) => (
            <LinkRow key={u.authUserId} user={u} options={participantOptions} />
          ))
        )}
      </section>

      {/* Sección 2: pre-asignar email por participante (roster Etapa 1) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#e6edf3]">Pre-asignar email por participante</h2>
        {rosterRows.map((r) => (
          <CuentaRow key={r.participantId} row={r} />
        ))}
      </section>
    </div>
  )
}

/** Fila de un usuario self-service con botón para borrarlo (cuenta + picks + auth). */
function DeleteRow({ row }: { row: ParticipantAccount }) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'confirm' | 'deleting' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function del() {
    setStatus('deleting'); setMsg('')
    try {
      const res = await fetch('/api/admin/cuentas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: row.participantId }),
      })
      const data = await res.json()
      if (res.ok) { router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#e6edf3] truncate">{row.nombre}</div>
        <div className="text-xs text-[#768390] truncate">{row.email}</div>
      </div>
      {status === 'confirm' ? (
        <>
          <span className="text-xs text-[#f85149]">¿Seguro?</span>
          <button
            onClick={del}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#f85149] text-white shrink-0"
          >
            Sí, borrar
          </button>
          <button
            onClick={() => setStatus('idle')}
            className="text-xs px-3 py-1.5 rounded-md border border-[#30363d] text-[#768390] shrink-0"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          onClick={() => setStatus('confirm')}
          disabled={status === 'deleting'}
          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-[#f85149]/40 text-[#f85149] hover:bg-[#f85149]/10 disabled:opacity-50 shrink-0"
        >
          {status === 'deleting' ? 'Borrando…' : '🗑 Borrar'}
        </button>
      )}
      {msg && <span className="text-xs text-[#f85149] shrink-0">{msg}</span>}
    </div>
  )
}

function LinkRow({ user, options }: { user: UnlinkedUser; options: ParticipantOption[] }) {
  const router = useRouter()
  const [participantId, setParticipantId] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function link() {
    if (!participantId) return
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, email: user.email, authUserId: user.authUserId }),
      })
      const data = await res.json()
      if (res.ok) { setStatus('saved'); setMsg('Vinculado ✓'); router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <span className="text-sm text-[#e6edf3] sm:flex-1 truncate">{user.email}</span>
      <select
        value={participantId}
        onChange={(e) => setParticipantId(e.target.value)}
        className="px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637] sm:w-56"
      >
        <option value="">— Vincular a participante —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.nombre}</option>
        ))}
      </select>
      <button
        onClick={link}
        disabled={status === 'saving' || !participantId}
        className="text-xs font-semibold px-3 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50 shrink-0"
      >
        {status === 'saving' ? 'Vinculando…' : 'Vincular'}
      </button>
      {msg && (
        <span className={`text-xs shrink-0 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</span>
      )}
    </div>
  )
}

function CuentaRow({ row }: { row: ParticipantAccount }) {
  const [email, setEmail] = useState(row.email)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function save() {
    setStatus('saving'); setMsg('')
    try {
      const res = await fetch('/api/admin/cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: row.participantId, email: email.trim() }),
      })
      const data = await res.json()
      if (res.ok) { setStatus('saved'); setMsg('Guardado ✓') }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch {
      setStatus('error'); setMsg('Error de red')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex items-center gap-2 sm:w-48 shrink-0">
        <span className="text-sm font-medium text-[#e6edf3] truncate">{row.nombre}</span>
        {row.vinculado && (
          <span className="text-[10px] font-semibold bg-[#9EE637]/15 text-[#9EE637] px-1.5 py-0.5 rounded shrink-0">
            vinculado
          </span>
        )}
      </div>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@ejemplo.com"
        className="flex-1 px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] placeholder-[#768390] focus:outline-none focus:border-[#9EE637]"
      />
      <button
        onClick={save}
        disabled={status === 'saving' || !email.trim()}
        className="text-xs font-semibold px-3 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50 shrink-0"
      >
        {status === 'saving' ? 'Guardando…' : 'Guardar'}
      </button>
      {msg && (
        <span className={`text-xs shrink-0 ${status === 'error' ? 'text-[#f85149]' : 'text-[#9EE637]'}`}>{msg}</span>
      )}
    </div>
  )
}
