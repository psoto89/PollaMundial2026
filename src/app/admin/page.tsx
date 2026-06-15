import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import AdminActions from '@/components/admin/AdminActions'

export const revalidate = 0

interface LiveMatchRow {
  id: string
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

export default async function AdminDashboard() {
  const db = createAdminClient()

  const [
    { count: participantsCount },
    { count: matchesCount },
    { data: liveMatchesRaw },
    { count: finishedMatchesCount },
  ] = await Promise.all([
    db.from('participants').select('*', { count: 'exact', head: true }),
    db.from('matches').select('*', { count: 'exact', head: true }),
    db
      .from('matches')
      .select(`
        id, goles_local, goles_visitante, minuto,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .eq('estado', 'live'),
    db.from('matches').select('*', { count: 'exact', head: true }).eq('estado', 'finished'),
  ])

  const liveMatches = (liveMatchesRaw ?? []) as unknown as LiveMatchRow[]

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-[#e6edf3]">Dashboard Admin</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Participantes', value: participantsCount ?? 0 },
          { label: 'Partidos totales', value: matchesCount ?? 0 },
          { label: 'Finalizados', value: finishedMatchesCount ?? 0 },
          { label: 'En vivo', value: liveMatches.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-[#9EE637] tabular-nums">{value}</div>
            <div className="text-xs text-[#768390] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Partidos en vivo */}
      {liveMatches.length > 0 && (
        <div className="bg-[#161b22] border border-[#f85149]/30 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-[#f85149] mb-3 flex items-center gap-2">
            <span className="live-dot w-2 h-2 rounded-full bg-[#f85149]" />
            Partidos en vivo
          </h2>
          <div className="space-y-2">
            {liveMatches.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <span className="text-[#e6edf3]">
                  {m.equipo_local?.nombre} {m.goles_local ?? '–'}–{m.goles_visitante ?? '–'} {m.equipo_visitante?.nombre}
                </span>
                {m.minuto !== null && <span className="text-[#768390]">{m.minuto}&apos;</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acciones TheSportsDB */}
      <div>
        <p className="text-xs font-semibold text-[#9EE637] uppercase tracking-widest mb-3">
          TheSportsDB — Mundial en curso
        </p>
        <AdminActions />
      </div>

      {/* Navegación */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link href="/admin/import">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 hover:border-[#9EE637]/40 transition-colors">
            <p className="text-xs font-semibold text-[#768390] uppercase tracking-widest mb-1">Paso 1</p>
            <h3 className="font-semibold text-[#e6edf3] mb-1">📥 Importar Excel</h3>
            <p className="text-sm text-[#768390]">Cargar Gran_Polla_Mundial_2026.xlsx con los pronósticos</p>
          </div>
        </Link>
        <Link href="/admin/results">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 hover:border-[#9EE637]/40 transition-colors">
            <h3 className="font-semibold text-[#e6edf3] mb-1">⚽ Cargar resultados</h3>
            <p className="text-sm text-[#768390]">Marcadores manuales, estado en vivo, resultados oficiales</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
