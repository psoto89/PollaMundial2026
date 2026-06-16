'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Si ya hay sesión, no mostrar el login: ir directo a Mi Polla
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/mis-pronosticos')
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setErrorMsg('')

    const supabase = createClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${appUrl}/auth/callback` },
    })

    if (error) {
      setStatus('error')
      setErrorMsg('No se pudo enviar el enlace. Revisa el correo e intenta de nuevo.')
      return
    }
    setStatus('sent')
  }

  return (
    <div className="max-w-md mx-auto py-12">
      <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight mb-2">Entrar</h1>
      <p className="text-sm text-[#768390] mb-6">
        Escribe tu correo y te enviamos un enlace mágico para entrar — sin contraseña.
      </p>

      {status === 'sent' ? (
        <div className="bg-[#161b22] border border-[#9EE637]/40 rounded-xl p-6 text-center">
          <p className="text-3xl mb-3">📬</p>
          <p className="text-[#e6edf3] font-medium">Revisa tu correo</p>
          <p className="text-sm text-[#768390] mt-1">
            Te enviamos un enlace a <span className="text-[#e6edf3]">{email}</span>. Ábrelo en este dispositivo.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
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
            {status === 'sending' ? 'Enviando…' : 'Enviar enlace'}
          </button>
          {status === 'error' && <p className="text-sm text-[#f85149]">{errorMsg}</p>}
          <p className="text-xs text-[#768390]">
            Usa el correo que el admin registró para ti. Si no estás en la lista, contáctalo.
          </p>
        </form>
      )}
    </div>
  )
}
