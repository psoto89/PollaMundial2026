import { createClient } from '@/lib/supabase/server'
import LiveBanner from '@/components/live/LiveBanner'
import Link from 'next/link'

export const revalidate = 30

interface LiveMatchRow {
  id: string
  fase: string | null
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

export default async function Home() {
  const supabase = await createClient()

  const [{ count: participantes }, { data: liveMatchesRaw }] = await Promise.all([
    supabase.from('scores_cache').select('*', { count: 'exact', head: true }),
    supabase
      .from('matches')
      .select(`
        id, fase, goles_local, goles_visitante, minuto,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .eq('estado', 'live'),
  ])

  const liveMatches = (liveMatchesRaw ?? []) as unknown as LiveMatchRow[]

  return (
    <div className="space-y-6">
      <LiveBanner initialMatches={liveMatches} />

      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">Gran Polla Mundial 2026</h1>
        <p className="text-sm text-[#768390] mt-1">{participantes ?? 0} participantes · elige una polla</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PollaCard
          href="/grupos"
          emoji="⚽"
          titulo="Polla 1"
          subtitulo="Fase de Grupos"
          desc="Tabla por aciertos de los 72 partidos de grupos."
          accent="#9EE637"
        />
        <PollaCard
          href="/eliminacion"
          emoji="🏆"
          titulo="Polla 2"
          subtitulo="Cuadro Eliminatorio"
          desc="Arma tu bracket: elige quién avanza y el marcador. Bonos por clasificados, semifinalistas y podio."
          accent="#58a6ff"
        />
      </div>

      <div className="flex items-center justify-center gap-4 text-sm">
        <Link href="/general" className="text-[#768390] hover:text-[#9EE637] transition-colors">
          Tabla general
        </Link>
        <span className="text-[#30363d]">·</span>
        <Link href="/mis-pronosticos" className="text-[#9EE637] font-medium hover:underline">
          Mi Polla
        </Link>
        <span className="text-[#30363d]">·</span>
        <Link href="/reglas" className="text-[#768390] hover:text-[#9EE637] transition-colors">
          Reglas
        </Link>
      </div>
    </div>
  )
}

function PollaCard({
  href, emoji, titulo, subtitulo, desc, accent,
}: {
  href: string; emoji: string; titulo: string; subtitulo: string; desc: string; accent: string
}) {
  return (
    <Link
      href={href}
      className="group relative block rounded-2xl border border-[#30363d] bg-[#161b22] p-6 overflow-hidden hover:border-[color:var(--accent)] transition-colors"
      style={{ ['--accent' as string]: accent }}
    >
      <div
        className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-10 blur-2xl transition-opacity group-hover:opacity-20"
        style={{ background: accent }}
      />
      <div className="text-4xl mb-3">{emoji}</div>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>{titulo}</div>
      <div className="text-xl font-bold text-[#e6edf3] mt-0.5">{subtitulo}</div>
      <p className="text-sm text-[#768390] mt-2">{desc}</p>
      <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: accent }}>
        Ver posiciones
        <span className="transition-transform group-hover:translate-x-0.5">→</span>
      </div>
    </Link>
  )
}
