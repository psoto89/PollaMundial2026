'use client'

import { useState } from 'react'

type ActionState = 'idle' | 'loading' | 'ok' | 'error'

interface ActionResult {
  updated?: number
  mapped?: number
  notMapped?: number
  newlyFinished?: number
  errors?: string[]
  error?: string
}

function ActionButton({
  label,
  description,
  endpoint,
  method = 'POST',
}: {
  label: string
  description: string
  endpoint: string
  method?: string
}) {
  const [state, setState] = useState<ActionState>('idle')
  const [result, setResult] = useState<ActionResult | null>(null)

  async function run() {
    setState('loading')
    setResult(null)
    try {
      const res = await fetch(endpoint, { method })
      const data = await res.json() as ActionResult
      setResult(data)
      setState(data.error ? 'error' : 'ok')
    } catch (err) {
      setResult({ error: String(err) })
      setState('error')
    }
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
      <h3 className="font-semibold text-[#e6edf3] mb-1">{label}</h3>
      <p className="text-sm text-[#768390] mb-4">{description}</p>

      <button
        onClick={run}
        disabled={state === 'loading'}
        className="px-4 py-2 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {state === 'loading' ? 'Ejecutando…' : label}
      </button>

      {state === 'ok' && result && (
        <div className="mt-3 text-xs text-[#9EE637] space-y-0.5">
          {result.updated !== undefined && <p>✓ {result.updated} partidos actualizados</p>}
          {result.mapped !== undefined && <p>✓ {result.mapped} mapeados</p>}
          {result.notMapped !== undefined && result.notMapped > 0 && (
            <p className="text-[#f85149]">⚠ {result.notMapped} sin mapear</p>
          )}
          {result.newlyFinished !== undefined && result.newlyFinished > 0 && (
            <p>⚡ {result.newlyFinished} nuevos FT → recalculando puntos</p>
          )}
          {result.errors && result.errors.length > 0 && (
            <p className="text-[#f85149]">Errores: {result.errors.join(', ')}</p>
          )}
        </div>
      )}

      {state === 'error' && (
        <p className="mt-3 text-xs text-[#f85149]">{result?.error ?? 'Error desconocido'}</p>
      )}
    </div>
  )
}

export default function AdminActions() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <ActionButton
        label="🔄 Sincronizar partidos"
        description="Descarga el schedule completo desde TheSportsDB: mapea IDs, kickoffs y marcadores de partidos terminados."
        endpoint="/api/admin/tsdb/sync"
        method="POST"
      />
      <ActionButton
        label="⚡ Recalcular puntos"
        description="Recalcula scores_cache para todos los participantes desde los resultados oficiales en la BD."
        endpoint="/api/admin/recalc"
        method="POST"
      />
    </div>
  )
}
