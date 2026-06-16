'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ParsedExcel } from '@/types'

type Step = 'upload' | 'preview' | 'done'

export default function AdminImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ParsedExcel | null>(null)
  const [result, setResult] = useState('')

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/admin/import', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Error al parsear el archivo')
    } else {
      setPreview(data.preview)
      setStep('preview')
    }
    setLoading(false)
  }

  async function handleConfirm() {
    if (!preview) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, preview }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Error al importar')
    } else {
      setResult(data.message ?? 'Importación completada')
      setStep('done')
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Importar Excel</h1>
        <p className="text-sm text-[#768390] mt-1">
          Carga el archivo <code className="bg-[#21262d] px-1.5 py-0.5 rounded text-xs">Gran_Polla_Mundial_2026.xlsx</code> para importar los pronósticos de todos los participantes.
        </p>
      </div>

      {error && (
        <div className="bg-[#f85149]/10 border border-[#f85149]/30 rounded-lg px-4 py-3 text-sm text-[#f85149]">
          {error}
        </div>
      )}

      {/* Paso 1: Upload */}
      {step === 'upload' && (
        <div className="border-2 border-dashed border-[#30363d] rounded-xl p-10 text-center hover:border-[#9EE637]/40 transition-colors">
          <p className="text-4xl mb-3">📥</p>
          <p className="text-sm text-[#768390] mb-4">Selecciona el archivo Excel con los pronósticos</p>
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-[#9EE637] text-[#0d1117] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
              {loading ? 'Analizando…' : 'Seleccionar archivo'}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
              disabled={loading}
            />
          </label>
        </div>
      )}

      {/* Paso 2: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
            <h2 className="font-semibold text-[#e6edf3] mb-3">Preview del archivo</h2>
            <div className="grid grid-cols-3 gap-3 text-center mb-4">
              <div>
                <div className="text-xl font-bold text-[#9EE637]">{preview.participants.length}</div>
                <div className="text-xs text-[#768390]">Participantes</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#9EE637]">{preview.teams.length}</div>
                <div className="text-xs text-[#768390]">Equipos</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#9EE637]">{preview.matches.length}</div>
                <div className="text-xs text-[#768390]">Partidos</div>
              </div>
            </div>

            {/* Lista de participantes */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {preview.participants.map((p) => (
                <div key={p.sheetAlias} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="text-[#768390] font-mono text-xs w-16 shrink-0">{p.sheetAlias}</span>
                  <span className="text-[#e6edf3] font-medium">{p.nombre}</span>
                  <span className="text-[#768390] text-xs ml-auto">
                    {p.predictionsGroup.filter(g => g.predLocal !== null).length}/72 partidos ·{' '}
                    {p.predictionsQualify.length} clasif. ·{' '}
                    {p.predictionsSemis.length} semis ·{' '}
                    {p.predictionsQuestions.filter(q => q.respuesta !== null).length}/6 preguntas
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('upload')}
              className="px-4 py-2 rounded-lg border border-[#30363d] text-sm text-[#768390] hover:text-[#e6edf3] transition-colors"
            >
              Cambiar archivo
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Importando…' : `Confirmar e importar (${preview.participants.length} participantes)`}
            </button>
          </div>

          <p className="text-xs text-[#768390]">
            ℹ️ Si ya existen datos, se actualizarán (upsert). Re-importar es seguro.
          </p>
        </div>
      )}

      {/* Paso 3: Done */}
      {step === 'done' && (
        <div className="bg-[#9EE637]/10 border border-[#9EE637]/30 rounded-xl p-6 text-center">
          <p className="text-3xl mb-3">✅</p>
          <p className="font-semibold text-[#e6edf3]">{result}</p>
          <p className="text-sm text-[#768390] mt-2">
            Los participantes ya aparecen en la tabla general.
          </p>
          <div className="flex gap-3 justify-center mt-4">
            <button
              onClick={() => { setStep('upload'); setPreview(null); setResult('') }}
              className="px-4 py-2 rounded-lg border border-[#30363d] text-sm text-[#768390] hover:text-[#e6edf3] transition-colors"
            >
              Importar otro archivo
            </button>
            <Link
              href="/"
              className="px-4 py-2 rounded-lg bg-[#9EE637] text-[#0d1117] font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Ver tabla →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
