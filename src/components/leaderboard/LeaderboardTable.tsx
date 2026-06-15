'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface ScoreRow {
  participant_id: string
  total: number
  total_grupos: number
  total_clasificados: number
  total_semis: number
  total_preguntas: number
  participants: {
    id: string
    nombre: string
    sheet_alias: string
    avatar_url: string | null
  } | null
}

interface Props {
  initialScores: ScoreRow[]
}

export default function LeaderboardTable({ initialScores }: Props) {
  const [scores, setScores] = useState<ScoreRow[]>(initialScores)
  const prevRanks = useRef<Map<string, number>>(new Map())
  const [flashMap, setFlashMap] = useState<Map<string, 'up' | 'down'>>(new Map())

  // Suscripción Realtime a scores_cache
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('scores-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores_cache' },
        async () => {
          // Re-fetch para tener datos completos con join
          const { data } = await supabase
            .from('scores_cache')
            .select('*, participants(id, nombre, sheet_alias, avatar_url)')
            .order('total', { ascending: false })
          if (data) {
            // Calcular cambios de posición para la animación
            const newRanks = new Map(data.map((s: ScoreRow, i: number) => [s.participant_id, i]))
            const newFlash = new Map<string, 'up' | 'down'>()
            for (const [pid, newRank] of newRanks.entries()) {
              const oldRank = prevRanks.current.get(pid)
              if (oldRank !== undefined && oldRank !== newRank) {
                newFlash.set(pid, newRank < oldRank ? 'up' : 'down')
              }
            }
            prevRanks.current = newRanks
            setFlashMap(newFlash)
            setScores(data)
            // Limpiar las clases de flash tras la animación
            setTimeout(() => setFlashMap(new Map()), 2000)
          }
        },
      )
      .subscribe()

    // Guardar posiciones iniciales
    prevRanks.current = new Map(initialScores.map((s, i) => [s.participant_id, i]))

    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (scores.length === 0) {
    return (
      <div className="text-center py-16 text-[#768390]">
        <p className="text-4xl mb-3">⚽</p>
        <p>Sin datos aún. El admin debe importar los pronósticos.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#30363d] text-[#768390] text-xs uppercase tracking-wide">
            <th className="text-left pb-3 pr-4 w-8">#</th>
            <th className="text-left pb-3 pr-4">Participante</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Grupos</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Clasif.</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Semis</th>
            <th className="text-right pb-3 px-2 hidden sm:table-cell">Preguntas</th>
            <th className="text-right pb-3 pl-4 font-bold text-[#e6edf3]">Total</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((row, idx) => {
            const flash = flashMap.get(row.participant_id)
            const participante = row.participants
            return (
              <tr
                key={row.participant_id}
                className={`
                  border-b border-[#21262d] transition-colors
                  hover:bg-[#161b22]
                  ${flash === 'up' ? 'rank-up' : ''}
                  ${flash === 'down' ? 'rank-down' : ''}
                `}
              >
                {/* Posición */}
                <td className="py-3 pr-4 text-[#768390] font-mono text-xs">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                </td>

                {/* Nombre */}
                <td className="py-3 pr-4">
                  <Link
                    href={`/participant/${participante?.id ?? row.participant_id}`}
                    className="font-medium text-[#e6edf3] hover:text-[#9EE637] transition-colors"
                  >
                    {participante?.nombre ?? row.participant_id}
                  </Link>
                </td>

                {/* Desglose (solo desktop) */}
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390]">
                  {row.total_grupos}
                </td>
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390]">
                  {row.total_clasificados}
                </td>
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390]">
                  {row.total_semis}
                </td>
                <td className="py-3 px-2 text-right hidden sm:table-cell text-[#768390]">
                  {row.total_preguntas}
                </td>

                {/* Total */}
                <td className="py-3 pl-4 text-right">
                  <span className="font-bold text-[#9EE637] tabular-nums text-base">
                    {row.total}
                  </span>
                  <span className="text-[#768390] text-xs ml-1">pts</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
