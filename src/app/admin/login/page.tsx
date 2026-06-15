'use client'

import { useState } from 'react'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (res.ok) {
      // Hard navigation: fuerza al browser a re-enviar las cookies recién seteadas
      window.location.href = '/admin'
      return
    } else {
      const data = await res.json()
      setError(data.error ?? 'Error al iniciar sesión')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-4xl mb-3">🌍</p>
          <h1 className="text-xl font-bold text-[#e6edf3]">Admin — Polla Mundial 2026</h1>
          <p className="text-sm text-[#768390] mt-1">Solo para Pedro</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#768390] mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-[#161b22] border border-[#30363d] text-[#e6edf3] placeholder:text-[#768390] focus:outline-none focus:border-[#9EE637] transition-colors text-sm"
              placeholder="••••••••"
              autoFocus
              required
            />
          </div>

          {error && (
            <p className="text-sm text-[#f85149]">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
