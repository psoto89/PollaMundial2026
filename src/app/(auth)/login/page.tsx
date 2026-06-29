'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Destino tras el login: respeta ?next= (solo rutas internas) o el cuadro por defecto.
function getNext(): string {
  if (typeof window === 'undefined') return '/mis-pronosticos'
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') ? next : '/mis-pronosticos'
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'verifying' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Si ya hay sesión, no mostrar el login: ir directo al destino (?next o el cuadro)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace(getNext())
    })
  }, [router])

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setErrorMsg('')

    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
    const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(getNext())}`
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    })

    if (error) {
      setStatus('error')
      const e = error as { status?: number; code?: string; name?: string; message?: string }
      const detalle = e.message && e.message.trim() ? e.message : (e.code ?? e.name ?? 'sin mensaje')
      setErrorMsg(`No se pudo enviar el enlace [${e.status ?? '?'} · ${e.code ?? '—'}]: ${detalle}`)
      return
    }
    setStatus('sent')
  }

  // Entrar con el código de 6 dígitos del correo (no depende de abrir el enlace).
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    const token = code.trim()
    if (token.length < 6) return
    setStatus('verifying')
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' })
    if (error) {
      setStatus('error')
      setErrorMsg('Código inválido o vencido. Revisa los 6 dígitos o pide uno nuevo.')
      return
    }
    // Sesión establecida en el navegador → navegación completa para que el server la lea
    window.location.href = getNext()
  }

  return (
    <div className="max-w-md mx-auto py-12">
      <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight mb-2">Crea tu cuenta o entra</h1>
      <p className="text-sm text-[#768390] mb-6">
        Escribe tu correo y te enviamos un enlace + un código — sin contraseña. Si es tu primera vez,
        tu cuenta se crea automáticamente.
      </p>

      {status === 'sent' || status === 'verifying' || (status === 'error' && code) ? (
        <div className="space-y-4">
          <div className="bg-[#161b22] border border-[#9EE637]/40 rounded-xl p-6 text-center">
            <p className="text-3xl mb-3">📬</p>
            <p className="text-[#e6edf3] font-medium">Revisa tu correo</p>
            <p className="text-sm text-[#768390] mt-1">
              Te enviamos un mensaje a <span className="text-[#e6edf3]">{email}</span>.
              Toca el botón del correo <strong className="text-[#e6edf3]">o</strong> escribe aquí el código de 6 dígitos.
            </p>
          </div>

          <form onSubmit={verifyCode} className="space-y-3">
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="w-full px-4 py-3 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-center text-2xl tracking-[0.5em] font-bold placeholder-[#444d56] focus:outline-none focus:border-[#9EE637]"
            />
            <button
              type="submit"
              disabled={status === 'verifying' || code.length < 6}
              className="w-full px-4 py-3 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold disabled:opacity-50 transition-opacity"
            >
              {status === 'verifying' ? 'Entrando…' : 'Entrar con código'}
            </button>
            {status === 'error' && <p className="text-sm text-[#f85149]">{errorMsg}</p>}
          </form>

          <button
            onClick={() => { setStatus('idle'); setCode('') }}
            className="text-xs text-[#768390] hover:text-[#9EE637] transition-colors"
          >
            ← Usar otro correo
          </button>
        </div>
      ) : (
        <form onSubmit={sendLink} className="space-y-4">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full px-4 py-3 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#e6edf3] placeholder-[#768390] focus:outline-none focus:border-[#9EE637]"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full px-4 py-3 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold disabled:opacity-50 transition-opacity"
          >
            {status === 'sending' ? 'Enviando…' : 'Enviar enlace y código'}
          </button>
          {status === 'error' && <p className="text-sm text-[#f85149]">{errorMsg}</p>}
          <p className="text-xs text-[#768390]">
            Si entras por un link de invitación, tu cuenta se une a la polla automáticamente.
          </p>
        </form>
      )}
    </div>
  )
}
