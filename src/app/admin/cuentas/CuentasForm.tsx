'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ParticipantAccount {
  participantId: string
  nombre: string
  email: string
  vinculado: boolean
  selfJoin: boolean
  polla1: boolean
  polla2: boolean
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
  rosterOptions,
}: {
  rows: ParticipantAccount[]
  unlinkedUsers: UnlinkedUser[]
  participantOptions: ParticipantOption[]
  rosterOptions: ParticipantOption[]
}) {
  const selfJoinUsers = rows.filter((r) => r.selfJoin)
  const rosterRows = rows.filter((r) => !r.selfJoin)

  return (
    <div className="space-y-8">
      {/* Tabla resumen: quién juega cada polla y su correo */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#e6edf3]">Resumen de participantes</h2>
        <div className="overflow-x-auto bg-[#161b22] border border-[#30363d] rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#768390] border-b border-[#30363d]">
                <th className="text-left font-semibold px-3 py-2">Nombre</th>
                <th className="text-center font-semibold px-2 py-2">Polla 1</th>
                <th className="text-center font-semibold px-2 py-2">Polla 2</th>
                <th className="text-left font-semibold px-3 py-2">Correo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.participantId} className="border-b border-[#21262d] last:border-0">
                  <td className="px-3 py-2 text-[#e6edf3]">
                    {r.nombre}
                    {r.selfJoin && <span className="ml-2 text-[10px] text-[#58a6ff]">self-service</span>}
                  </td>
                  <td className="px-2 py-2 text-center">{r.polla1 ? '✅' : '—'}</td>
                  <td className="px-2 py-2 text-center">{r.polla2 ? '✅' : '—'}</td>
                  <td className="px-3 py-2 text-[#768390] truncate max-w-[220px]">{r.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sección 0: usuarios self-service → fusionar con su participante de Etapa 1, o borrar */}
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
          Cuentas creadas desde el login. Si la persona ya está en la Etapa 1, <strong className="text-[#e6edf3]">fusiónala</strong>
          {' '}con su participante (junta las dos pollas con un solo correo). Borrar = para usuarios de prueba.
        </p>
        {selfJoinUsers.length === 0 ? (
          <p className="text-sm text-[#768390]">Ninguno todavía.</p>
        ) : (
          selfJoinUsers.map((r) => <SelfJoinRow key={r.participantId} row={r} rosterOptions={rosterOptions} />)
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

/** Fila de un usuario self-service: fusionar con un participante de la Etapa 1, o borrar. */
function SelfJoinRow({ row, rosterOptions }: { row: ParticipantAccount; rosterOptions: ParticipantOption[] }) {
  const router = useRouter()
  const [target, setTarget] = useState('')
  const [status, setStatus] = useState<'idle' | 'confirm' | 'working' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function merge() {
    if (!target) return
    setStatus('working'); setMsg('')
    try {
      const res = await fetch('/api/admin/cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeFrom: row.participantId, mergeTo: target }),
      })
      const data = await res.json()
      if (res.ok) { router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch { setStatus('error'); setMsg('Error de red') }
  }

  async function del() {
    setStatus('working'); setMsg('')
    try {
      const res = await fetch('/api/admin/cuentas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: row.participantId }),
      })
      const data = await res.json()
      if (res.ok) { router.refresh() }
      else { setStatus('error'); setMsg(data.error?.toString?.() ?? 'Error') }
    } catch { setStatus('error'); setMsg('Error de red') }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="min-w-0 sm:flex-1">
        <div className="text-sm font-medium text-[#e6edf3] truncate">{row.nombre}</div>
        <div className="text-xs text-[#768390] truncate">{row.email}</div>
      </div>

      {/* Fusionar con un participante del roster */}
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="px-3 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637] sm:w-52"
      >
        <option value="">— Fusionar con Etapa 1 —</option>
        {rosterOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.nombre}</option>
        ))}
      </select>
      <button
        onClick={merge}
        disabled={status === 'working' || !target}
        className="text-xs font-semibold px-3 py-2 rounded-md bg-[#9EE637] text-[#0d1117] disabled:opacity-50 shrink-0"
      >
        {status === 'working' ? '…' : 'Fusionar'}
      </button>

      {status === 'confirm' ? (
        <>
          <span className="text-xs text-[#f85149] shrink-0">¿Borrar?</span>
          <button onClick={del} className="text-xs font-semibold px-2.5 py-2 rounded-md bg-[#f85149] text-white shrink-0">Sí</button>
          <button onClick={() => setStatus('idle')} className="text-xs px-2.5 py-2 rounded-md border border-[#30363d] text-[#768390] shrink-0">No</button>
        </>
      ) : (
        <button
          onClick={() => setStatus('confirm')}
          disabled={status === 'working'}
          className="text-xs font-semibold px-3 py-2 rounded-md border border-[#f85149]/40 text-[#f85149] hover:bg-[#f85149]/10 disabled:opacity-50 shrink-0"
        >
          🗑
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
