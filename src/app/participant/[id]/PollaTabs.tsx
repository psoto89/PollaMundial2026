'use client'

import { useState } from 'react'

/**
 * Pestañas del perfil de un participante: primero elige Polla 1 (grupos) o
 * Polla 2 (cuadro), y adentro muestra el contenido de cada una.
 */
export default function PollaTabs({
  polla1,
  polla2,
  hasBracket,
}: {
  polla1: React.ReactNode
  polla2: React.ReactNode
  hasBracket: boolean
}) {
  const [tab, setTab] = useState<'p1' | 'p2'>('p1')

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-[#0d1117] border border-[#30363d] rounded-lg p-1">
        <button
          onClick={() => setTab('p1')}
          className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
            tab === 'p1' ? 'bg-[#9EE637] text-[#0d1117]' : 'text-[#768390] hover:text-[#e6edf3]'
          }`}
        >
          Polla 1 · Grupos
        </button>
        <button
          onClick={() => setTab('p2')}
          className={`flex-1 text-sm font-semibold py-2 rounded-md transition-colors ${
            tab === 'p2' ? 'bg-[#9EE637] text-[#0d1117]' : 'text-[#768390] hover:text-[#e6edf3]'
          }`}
        >
          Polla 2 · Cuadro
        </button>
      </div>

      {tab === 'p1' ? (
        polla1
      ) : hasBracket ? (
        polla2
      ) : (
        <div className="text-center py-12 text-[#768390] bg-[#161b22] border border-[#30363d] rounded-xl">
          <p className="text-3xl mb-2">🏆</p>
          <p className="text-sm">Esta persona aún no ha armado su cuadro de la Polla 2.</p>
        </div>
      )}
    </div>
  )
}
