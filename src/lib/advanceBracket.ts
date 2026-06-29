/**
 * lib/advanceBracket.ts
 * Avance automático de la llave OFICIAL: crea los partidos de la siguiente ronda
 * cuando sus dos partidos "fuente" ya finalizaron con clasificado (advancer).
 *   - octavos: ganadores de cada par de 16avos
 *   - cuartos / semis: ídem
 *   - 3er puesto: perdedores de las semis · final: ganadores de las semis
 * Idempotente: salta los slots que ya tienen partido. Se llama tras cada partido
 * de eliminación finalizado (sync TheSportsDB + carga manual) y en el seed.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { BRACKET_2026, ROUND_ORDER, type RoundKey, type SlotSource } from '@/config/bracket2026'

type Client = ReturnType<typeof createAdminClient>

const ROUND_FASE: Record<RoundKey, string> = {
  dieciseisavos: 'dieciseisavos',
  octavos: 'octavos',
  cuartos: 'cuartos',
  semis: 'semis',
  tercer_puesto: 'tercer_puesto',
  final: 'final',
}

interface SlotMatch {
  estado: string
  advancer_team_id: string | null
  equipo_local_id: string | null
  equipo_visitante_id: string | null
}

export async function advanceBracket(db: Client): Promise<{ created: string[] }> {
  const { data: matchesRaw } = await db
    .from('matches')
    .select('bracket_slot, estado, advancer_team_id, equipo_local_id, equipo_visitante_id, match_index')
    .not('bracket_slot', 'is', null)

  const bySlot = new Map<string, SlotMatch>()
  let maxIndex = 71
  for (const m of (matchesRaw ?? []) as (SlotMatch & { bracket_slot: string; match_index: number })[]) {
    bySlot.set(m.bracket_slot, m)
    if (m.match_index > maxIndex) maxIndex = m.match_index
  }

  // Equipo que sale de un slot fuente (ganador o perdedor del partido real)
  const teamFromSource = (src?: SlotSource): string | null => {
    if (!src) return null
    const m = bySlot.get(src.slot)
    if (!m || m.estado !== 'finished' || !m.advancer_team_id) return null
    if (src.kind === 'winner') return m.advancer_team_id
    return m.advancer_team_id === m.equipo_local_id ? m.equipo_visitante_id : m.equipo_local_id
  }

  const created: string[] = []
  const baseKickoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  // Rondas en orden: una sola pasada cascada lo que ya esté decidido
  for (const round of ROUND_ORDER) {
    if (round === 'dieciseisavos') continue
    for (const s of BRACKET_2026.filter((x) => x.round === round)) {
      if (bySlot.has(s.slot)) continue
      const localId = teamFromSource(s.localSource)
      const visitanteId = teamFromSource(s.visitanteSource)
      if (!localId || !visitanteId) continue

      maxIndex += 1
      const { error } = await db.from('matches').insert({
        fase: ROUND_FASE[round],
        grupo: null,
        equipo_local_id: localId,
        equipo_visitante_id: visitanteId,
        match_index: maxIndex,
        bracket_slot: s.slot,
        kickoff_at: baseKickoff,
        estado: 'scheduled',
      })
      if (!error) {
        created.push(s.slot)
        bySlot.set(s.slot, {
          estado: 'scheduled', advancer_team_id: null,
          equipo_local_id: localId, equipo_visitante_id: visitanteId,
        })
      }
    }
  }

  return { created }
}
