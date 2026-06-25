'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface LiveMatch {
  id: string
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

interface Props {
  initialMatches: LiveMatch[]
}

export default function LiveBanner({ initialMatches }: Props) {
  const [matches, setMatches] = useState<LiveMatch[]>(initialMatches)

  // Refresco en vivo: realtime sobre matches + fallback cada 30s. Lee el estado
  // fresco de la BD (que actualizan el cron y el poll de la tabla) sin recargar.
  useEffect(() => {
    const supabase = createClient()

    async function refetch() {
      const { data } = await supabase
        .from('matches')
        .select(`
          id, goles_local, goles_visitante, minuto,
          equipo_local:teams!equipo_local_id(nombre),
          equipo_visitante:teams!equipo_visitante_id(nombre)
        `)
        .eq('estado', 'live')
      setMatches((data ?? []) as unknown as LiveMatch[])
    }

    const channel = supabase
      .channel('livebanner-matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, refetch)
      .subscribe()

    const interval = setInterval(refetch, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [])

  if (matches.length === 0) return null

  return (
    <Link href="/live">
      <div className="bg-[#161b22] border border-[#f85149]/40 rounded-lg divide-y divide-[#21262d] hover:border-[#f85149]/70 transition-colors cursor-pointer overflow-hidden">
        {matches.map((match) => (
          <div key={match.id} className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="live-dot w-2.5 h-2.5 rounded-full bg-[#f85149] shrink-0" />
              <span className="text-xs font-semibold text-[#f85149] uppercase tracking-widest shrink-0">
                En Vivo
              </span>
              <span className="text-[#768390] text-sm shrink-0">·</span>
              <span className="text-sm text-[#e6edf3] font-medium truncate">
                {match.equipo_local?.nombre} {match.goles_local ?? '–'} – {match.goles_visitante ?? '–'} {match.equipo_visitante?.nombre}
              </span>
              {match.minuto !== null && (
                <span className="text-xs text-[#768390] shrink-0">{match.minuto}&apos;</span>
              )}
            </div>
            <span className="text-xs text-[#9EE637] shrink-0">Ver →</span>
          </div>
        ))}
      </div>
    </Link>
  )
}
