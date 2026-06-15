'use client'

import { useState } from 'react'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MappedItem {
  bdlId:            number
  bdlStatus:        string
  bdlHome:          string
  bdlAway:          string
  bdlHomeScore:     number | null
  bdlAwayScore:     number | null
  ourHome:          string
  ourAway:          string
  ourEstado:        string
  bdlEstado:        string
  willUpdateId:     boolean
  willUpdateScore:  boolean
  willUpdateEstado: boolean
  isReversed:       boolean
}

interface UnmappedItem {
  bdlId:   number
  bdlHome: string
  bdlAway: string
  group:   string | null
}

interface PreviewResponse {
  ok:            boolean
  preview:       boolean
  total_bdl:     number
  mapped:        number
  unmapped:      number
  mappedItems:   MappedItem[]
  unmappedItems: UnmappedItem[]
  error?:        string
}

interface ConfirmResponse {
  ok:            boolean
  confirm:       boolean
  updated:       number
  skipped:       number
  unmapped:      number
  errors?:       string[]
  unmappedTeams?: UnmappedItem[]
  error?:        string
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function BdlSyncPage() {
  const [step, setStep]       = useState<'idle' | 'loading' | 'preview' | 'confirming' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [result,  setResult]  = useState<ConfirmResponse  | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function handlePreview() {
    setStep('loading')
    setError(null)
    try {
      const res = await fetch('/api/admin/bdl/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ preview: true }),
      })
      const data = await res.json() as PreviewResponse
      if (!data.ok) {
        setError(data.error ?? 'Error desconocido')
        setStep('error')
        return
      }
      setPreview(data)
      setStep('preview')
    } catch (err) {
      setError(String(err))
      setStep('error')
    }
  }

  async function handleConfirm() {
    setStep('confirming')
    setError(null)
    try {
      const res = await fetch('/api/admin/bdl/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ confirm: true }),
      })
      const data = await res.json() as ConfirmResponse
      if (!data.ok) {
        setError(data.error ?? 'Error desconocido')
        setStep('error')
        return
      }
      setResult(data)
      setStep('done')
    } catch (err) {
      setError(String(err))
      setStep('error')
    }
  }

  const willUpdate = preview?.mappedItems.filter(
    (m) => m.willUpdateId || m.willUpdateScore || m.willUpdateEstado,
  ) ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Sync BallDontLie</h1>
        <p className="text-sm text-[#768390] mt-1">
          Mapea los partidos de tu BD con los IDs de BallDontLie y actualiza marcadores actuales.
          <span className="text-[#f85149] ml-1 font-medium">Importa el Excel primero.</span>
        </p>
      </div>

      {/* Info card */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-sm space-y-1">
        <p className="text-[#e6edf3] font-medium">¿Qué hace este sync?</p>
        <ul className="text-[#768390] space-y-1 list-disc list-inside">
          <li>Llama a <code className="text-[#9EE637] text-xs">GET /fifa/worldcup/v1/matches?seasons[]=2026</code></li>
          <li>Cruza por nombre de equipo (normalizado) con tus partidos</li>
          <li>Actualiza <code className="text-[#9EE637] text-xs">external_id</code> → necesario para que el webhook funcione</li>
          <li>Actualiza marcadores y estado de los partidos ya jugados</li>
          <li>No pisa partidos con <code className="text-[#9EE637] text-xs">last_source = &apos;manual&apos;</code> reciente</li>
        </ul>
      </div>

      {/* Paso 1: preview */}
      {step === 'idle' && (
        <button
          onClick={handlePreview}
          className="bg-[#9EE637] text-[#0d1117] font-semibold px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
        >
          Obtener preview desde BallDontLie
        </button>
      )}

      {step === 'loading' && (
        <div className="flex items-center gap-3 text-[#768390]">
          <div className="w-4 h-4 border-2 border-[#9EE637] border-t-transparent rounded-full animate-spin" />
          Consultando BallDontLie API...
        </div>
      )}

      {step === 'error' && (
        <div className="bg-[#f85149]/10 border border-[#f85149]/30 rounded-xl p-4">
          <p className="text-[#f85149] font-medium text-sm">Error</p>
          <p className="text-[#768390] text-sm mt-1">{error}</p>
          <button
            onClick={() => setStep('idle')}
            className="mt-3 text-sm text-[#9EE637] hover:underline"
          >
            Volver a intentar
          </button>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Partidos BDL',  value: preview.total_bdl,  color: 'text-[#e6edf3]' },
              { label: 'Mapeados',      value: preview.mapped,     color: 'text-[#9EE637]' },
              { label: 'Sin mapear',    value: preview.unmapped,   color: preview.unmapped > 0 ? 'text-[#f85149]' : 'text-[#768390]' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
                <div className="text-xs text-[#768390]">{label}</div>
              </div>
            ))}
          </div>

          {/* Qué se va a actualizar */}
          {willUpdate.length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#e6edf3]">
                  Partidos que se actualizarán ({willUpdate.length})
                </h3>
                <span className="text-xs text-[#768390]">Solo mostrando los que cambian</span>
              </div>
              <div className="divide-y divide-[#21262d] max-h-80 overflow-y-auto">
                {willUpdate.map((m) => (
                  <div key={m.bdlId} className="px-4 py-3 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[#e6edf3] font-medium">
                        {m.ourHome} vs {m.ourAway}
                      </span>
                      {m.isReversed && (
                        <span className="text-[#f0ad4e] bg-[#f0ad4e]/10 px-1.5 py-0.5 rounded text-[10px]">
                          ↔ invertido
                        </span>
                      )}
                      <span className="text-[#768390]">ID BDL: {m.bdlId}</span>
                    </div>
                    <div className="flex gap-4 mt-1 flex-wrap">
                      {m.willUpdateId && (
                        <span className="text-[#9EE637]">
                          external_id → {m.bdlId}
                        </span>
                      )}
                      {m.willUpdateScore && m.bdlHomeScore !== null && (
                        <span className="text-[#58a6ff]">
                          marcador → {m.bdlHomeScore}–{m.bdlAwayScore}
                        </span>
                      )}
                      {m.willUpdateEstado && (
                        <span className="text-[#f0ad4e]">
                          estado → {m.bdlEstado}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Partidos sin mapear */}
          {preview.unmappedItems.length > 0 && (
            <div className="bg-[#161b22] border border-[#f85149]/20 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#21262d]">
                <h3 className="text-sm font-semibold text-[#f85149]">
                  Sin mapear ({preview.unmappedItems.length})
                </h3>
                <p className="text-xs text-[#768390] mt-0.5">
                  Agrega los aliases a TEAM_ALIASES en config/excelMap.ts
                </p>
              </div>
              <div className="divide-y divide-[#21262d] max-h-48 overflow-y-auto">
                {preview.unmappedItems.map((m) => (
                  <div key={m.bdlId} className="px-4 py-2 text-xs text-[#768390]">
                    <span className="text-[#e6edf3]">{m.bdlHome}</span> vs{' '}
                    <span className="text-[#e6edf3]">{m.bdlAway}</span>
                    {m.group && <span className="ml-2">· Grupo {m.group}</span>}
                    <span className="ml-2 font-mono text-[#9EE637]">ID: {m.bdlId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleConfirm}
              disabled={willUpdate.length === 0}
              className="bg-[#9EE637] text-[#0d1117] font-semibold px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              Confirmar y aplicar ({willUpdate.length} cambios)
            </button>
            <button
              onClick={handlePreview}
              className="border border-[#30363d] text-[#768390] hover:text-[#e6edf3] px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              Refrescar preview
            </button>
          </div>
        </div>
      )}

      {step === 'confirming' && (
        <div className="flex items-center gap-3 text-[#768390]">
          <div className="w-4 h-4 border-2 border-[#9EE637] border-t-transparent rounded-full animate-spin" />
          Aplicando sync en Supabase...
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="bg-[#9EE637]/10 border border-[#9EE637]/30 rounded-xl p-5">
            <p className="text-[#9EE637] font-semibold text-base">
              ✓ Sync completado
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Actualizados', value: result.updated },
                { label: 'Sin mapear',  value: result.unmapped },
                { label: 'Errores',     value: result.errors?.length ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-xl font-bold text-[#e6edf3]">{value}</div>
                  <div className="text-xs text-[#768390]">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {result.unmappedTeams && result.unmappedTeams.length > 0 && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-xs">
              <p className="text-[#f85149] font-medium mb-2">
                Equipos sin mapear ({result.unmappedTeams.length}):
              </p>
              <p className="text-[#768390] leading-relaxed">
                {result.unmappedTeams.map((t) => `${t.bdlHome} vs ${t.bdlAway}`).join(' · ')}
              </p>
              <p className="text-[#768390] mt-2">
                Agrega los aliases en <code className="text-[#9EE637]">src/config/excelMap.ts → TEAM_ALIASES</code>
                {' '}y vuelve a correr el sync.
              </p>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="bg-[#f85149]/10 border border-[#f85149]/20 rounded-xl p-4 text-xs text-[#f85149]">
              <p className="font-medium mb-1">Errores de BD:</p>
              {result.errors.map((e, i) => <p key={i} className="opacity-80">{e}</p>)}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('idle'); setPreview(null); setResult(null) }}
              className="border border-[#30363d] text-[#768390] hover:text-[#e6edf3] px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Volver a sync
            </button>
            <a
              href="/admin"
              className="border border-[#30363d] text-[#768390] hover:text-[#e6edf3] px-5 py-2 rounded-lg text-sm transition-colors"
            >
              Ir al dashboard
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
