/**
 * lib/autoSemis.ts
 * Sincroniza los semifinalistas / puestos finales de la Polla 1
 * (official_results scope='semis') a partir de los partidos de eliminación.
 * 100% automático: los partidos y marcadores llegan por la API de TheSportsDB
 * y de aquí se derivan los equipos, sin carga manual.
 *
 * Reglas de negocio:
 *   - Semifinalistas = los equipos que LLEGARON a semifinales, es decir, los
 *     participantes de los partidos de fase 'semis' (existan o no jugados aún).
 *     Cada acierto de un participante suma +10 (scoreSemis).
 *   - Dos fases de escritura:
 *       · Solo semifinalistas conocidos (final aún sin resolver) → claves sf1..sf4.
 *         Otorgan el +10 pero NO el bono de puesto (las claves no coinciden con
 *         los `puesto` de predictions_semis: campeon/subcampeon/3/4).
 *       · Final y 3er puesto finalizados → claves campeon/subcampeon/3/4.
 *         Mantiene el +10 y activa el bono de puesto exacto (20/15/12/10).
 *   - Reemplazo atómico de todo scope='semis' para no dejar filas colgadas al
 *     pasar de una fase a otra, con guard de "sin cambios" para no reescribir.
 *   - Si aún no hay ningún semifinalista, NO se toca official_results.
 *
 * El match de scoreSemis es por NOMBRE de equipo, por eso se mapea id → nombre.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { deriveAdvancer } from '@/lib/scoring'

type Db = ReturnType<typeof createAdminClient>

export interface KnockoutRow {
  fase: string
  bracket_slot: string | null
  estado: string
  goles_local: number | null
  goles_visitante: number | null
  advancer_team_id: string | null
  equipo_local_id: string | null
  equipo_visitante_id: string | null
}

export type SemisRow = { scope: 'semis'; key: string; value: { team: string } }

export interface SyncSemisResult {
  /** true si se reescribió official_results scope='semis'. */
  changed: boolean
  /** Fase detectada: 'none' (nada que derivar), 'semis' (sf1..sf4) o 'final'. */
  phase: 'none' | 'semis' | 'final'
  /** Nombres de los equipos escritos (para logging/depuración). */
  teams: string[]
}

// Detectores de ronda robustos: por `fase` (fuente principal) o por bracket_slot.
const isSemi = (m: KnockoutRow) => m.fase === 'semis' || (m.bracket_slot?.startsWith('SF-') ?? false)
const isFinal = (m: KnockoutRow) => m.fase === 'final' || m.bracket_slot === 'F'
const isThird = (m: KnockoutRow) => m.fase === 'tercer_puesto' || m.bracket_slot === '3P'

/**
 * Deriva y escribe los semifinalistas/puestos finales oficiales de la Polla 1.
 * Idempotente: correrla varias veces produce el mismo estado.
 */
export async function syncSemisFromResults(db: Db): Promise<SyncSemisResult> {
  const [{ data: matchesData }, { data: teamsData }, { data: currentData }] = await Promise.all([
    db
      .from('matches')
      .select('fase, bracket_slot, estado, goles_local, goles_visitante, advancer_team_id, equipo_local_id, equipo_visitante_id')
      .neq('fase', 'grupos'),
    db.from('teams').select('id, nombre'),
    db.from('official_results').select('key, value').eq('scope', 'semis'),
  ])

  const matches = (matchesData ?? []) as KnockoutRow[]
  const teams = (teamsData ?? []) as { id: string; nombre: string }[]
  const current = (currentData ?? []) as { key: string; value: { team?: string } }[]
  if (teams.length === 0) return { changed: false, phase: 'none', teams: [] }

  const nameById = new Map(teams.map((t) => [t.id, t.nombre]))
  const { rows, phase } = computeSemisRows(matches, nameById)

  if (phase === 'none') {
    // Aún no hay semifinalistas: no tocar official_results.
    return { changed: false, phase, teams: [] }
  }

  // No reescribir si el conjunto ya es el mismo (evita recalc innecesario en cada poll).
  if (sameSemisSet(current, rows)) {
    return { changed: false, phase, teams: rows.map((r) => r.value.team) }
  }

  // Reemplazo atómico de todas las filas scope='semis'.
  const { error: delError } = await db.from('official_results').delete().eq('scope', 'semis')
  if (delError) throw new Error(`official_results delete (autoSemis): ${delError.message}`)

  if (rows.length > 0) {
    const { error } = await db.from('official_results').insert(rows)
    if (error) throw new Error(`official_results insert (autoSemis): ${error.message}`)
  }

  return { changed: true, phase, teams: rows.map((r) => r.value.team) }
}

/**
 * Núcleo puro: a partir de los partidos de eliminación y el mapa id→nombre,
 * decide la fase y las filas official_results (scope='semis') a escribir.
 * Sin I/O — testeable de forma determinista.
 */
export function computeSemisRows(
  matches: KnockoutRow[],
  nameById: Map<string, string>,
): { rows: SemisRow[]; phase: SyncSemisResult['phase'] } {
  const name = (id: string | null): string | null => (id ? nameById.get(id) ?? null : null)

  // Semifinalistas = participantes (ambos equipos) de los partidos de semis.
  // Llegar a la semi ya cuenta, esté jugado el partido o no.
  const semifinalistIds: string[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (!isSemi(m)) continue
    for (const id of [m.equipo_local_id, m.equipo_visitante_id]) {
      if (id && !seen.has(id)) {
        seen.add(id)
        semifinalistIds.push(id)
      }
    }
  }

  // Puestos finales: Final y 3er puesto, solo si están finalizados con clasificado.
  const finResolved = resolvePositions(matches.find(isFinal))
  const tpResolved = resolvePositions(matches.find(isThird))

  if (finResolved && tpResolved) {
    const entries: [string, string | null][] = [
      ['campeon', finResolved.winner],
      ['subcampeon', finResolved.loser],
      ['3', tpResolved.winner],
      ['4', tpResolved.loser],
    ]
    return { rows: toRows(entries, name), phase: 'final' }
  }

  if (semifinalistIds.length > 0) {
    const entries = semifinalistIds.map((id, i): [string, string | null] => [`sf${i + 1}`, id])
    return { rows: toRows(entries, name), phase: 'semis' }
  }

  return { rows: [], phase: 'none' }
}

/**
 * Resuelve ganador/perdedor de un partido finalizado. El clasificado se deriva
 * del marcador (empate a 120' → el explícito por penales). Devuelve null si el
 * partido no existe, no está finalizado, o no se puede resolver el clasificado.
 */
function resolvePositions(
  m: KnockoutRow | undefined,
): { winner: string; loser: string | null } | null {
  if (!m || m.estado !== 'finished' || m.goles_local === null) return null
  const winner = deriveAdvancer(
    m.goles_local, m.goles_visitante,
    m.equipo_local_id, m.equipo_visitante_id,
    m.advancer_team_id,
  )
  if (!winner) return null
  const loser = winner === m.equipo_local_id ? m.equipo_visitante_id : m.equipo_local_id
  return { winner, loser }
}

/** Compara el conjunto actual de filas semis con el deseado (clave→equipo). */
function sameSemisSet(
  current: { key: string; value: { team?: string } }[],
  desired: { key: string; value: { team: string } }[],
): boolean {
  if (current.length !== desired.length) return false
  const curMap = new Map(current.map((r) => [r.key, r.value?.team ?? '']))
  return desired.every((r) => curMap.get(r.key) === r.value.team)
}

/** Convierte pares [clave, teamId] en filas official_results, descartando los sin nombre. */
function toRows(
  entries: [string, string | null][],
  name: (id: string | null) => string | null,
): { scope: 'semis'; key: string; value: { team: string } }[] {
  return entries
    .map(([key, id]) => ({ key, team: name(id) }))
    .filter((r): r is { key: string; team: string } => Boolean(r.team))
    .map((r) => ({ scope: 'semis' as const, key: r.key, value: { team: r.team } }))
}
