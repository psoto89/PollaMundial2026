import { createAdminClient } from '@/lib/supabase/admin'
import BracketForm, { type TeamOption, type ExistingMatch } from './BracketForm'

export const revalidate = 0

export default async function AdminBracketPage() {
  const db = createAdminClient()

  const [{ data: teams }, { data: matchesRaw }] = await Promise.all([
    db.from('teams').select('id, nombre').order('nombre'),
    db
      .from('matches')
      .select(`
        id, fase, kickoff_at, estado,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .neq('fase', 'grupos')
      .order('kickoff_at', { ascending: true }),
  ])

  const teamOptions = ((teams ?? []) as { id: string; nombre: string }[]).map((t) => ({
    id: t.id,
    nombre: t.nombre,
  })) as TeamOption[]

  type Row = {
    id: string; fase: string; kickoff_at: string | null; estado: string
    equipo_local: { nombre: string } | null
    equipo_visitante: { nombre: string } | null
  }
  const existing: ExistingMatch[] = ((matchesRaw ?? []) as unknown as Row[]).map((m) => ({
    id: m.id,
    fase: m.fase,
    kickoffAt: m.kickoff_at,
    estado: m.estado,
    local: m.equipo_local?.nombre ?? '—',
    visitante: m.equipo_visitante?.nombre ?? '—',
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Bracket — Eliminación</h1>
        <p className="text-sm text-[#768390] mt-1">
          Crea los partidos de cada ronda cuando se definan los cruces. Quedan abiertos para pronóstico
          hasta 1h antes del kickoff. TheSportsDB les pega el marcador después.
        </p>
      </div>
      <BracketForm teams={teamOptions} existing={existing} />
    </div>
  )
}
