import { createAdminClient } from '@/lib/supabase/admin'
import BracketForm, { type TeamOption, type ExistingMatch } from './BracketForm'

export const revalidate = 0

export default async function AdminBracketPage() {
  const db = createAdminClient()

  const [{ data: teams }, { data: matchesRaw }, { data: cfg }] = await Promise.all([
    db.from('teams').select('id, nombre').order('nombre'),
    db
      .from('matches')
      .select(`
        id, fase, bracket_slot, kickoff_at, estado,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .neq('fase', 'grupos')
      .order('kickoff_at', { ascending: true }),
    db.from('app_config').select('open_rounds').eq('id', 1).maybeSingle(),
  ])

  const teamOptions = ((teams ?? []) as { id: string; nombre: string }[]).map((t) => ({
    id: t.id,
    nombre: t.nombre,
  })) as TeamOption[]

  type Row = {
    id: string; fase: string; bracket_slot: string | null; kickoff_at: string | null; estado: string
    equipo_local: { nombre: string } | null
    equipo_visitante: { nombre: string } | null
  }
  const rows = (matchesRaw ?? []) as unknown as Row[]
  const existing: ExistingMatch[] = rows.map((m) => ({
    id: m.id,
    fase: m.fase,
    bracketSlot: m.bracket_slot,
    kickoffAt: m.kickoff_at,
    estado: m.estado,
    local: m.equipo_local?.nombre ?? '—',
    visitante: m.equipo_visitante?.nombre ?? '—',
  }))
  const usedSlots = rows.map((m) => m.bracket_slot).filter((s): s is string => !!s)
  const openRounds = (cfg?.open_rounds as string[] | null) ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Bracket — Eliminación</h1>
        <p className="text-sm text-[#768390] mt-1">
          Crea los partidos de cada ronda cuando se definan los cruces. Quedan abiertos para pronóstico
          hasta 1h antes del kickoff. TheSportsDB les pega el marcador después.
        </p>
      </div>
      <BracketForm
        teams={teamOptions}
        existing={existing}
        usedSlots={usedSlots}
        openRounds={openRounds}
      />
    </div>
  )
}
