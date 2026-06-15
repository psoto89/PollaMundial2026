'use client'

import Link from 'next/link'

interface LiveMatch {
  id: string
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

interface Props {
  match: LiveMatch
}

export default function LiveBanner({ match }: Props) {
  return (
    <Link href="/live">
      <div className="bg-[#161b22] border border-[#f85149]/40 rounded-lg p-4 flex items-center justify-between hover:border-[#f85149]/70 transition-colors cursor-pointer">
        <div className="flex items-center gap-3">
          <span className="live-dot w-2.5 h-2.5 rounded-full bg-[#f85149] shrink-0" />
          <span className="text-xs font-semibold text-[#f85149] uppercase tracking-widest">
            En Vivo
          </span>
          <span className="text-[#768390] text-sm">·</span>
          <span className="text-sm text-[#e6edf3] font-medium">
            {match.equipo_local?.nombre} {match.goles_local ?? '–'} – {match.goles_visitante ?? '–'} {match.equipo_visitante?.nombre}
          </span>
          {match.minuto !== null && (
            <span className="text-xs text-[#768390]">{match.minuto}&apos;</span>
          )}
        </div>
        <span className="text-xs text-[#9EE637]">Ver →</span>
      </div>
    </Link>
  )
}
