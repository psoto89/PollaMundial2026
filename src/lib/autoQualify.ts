/**
 * lib/autoQualify.ts
 * Sincroniza las posiciones oficiales de los grupos (official_results scope=qualify)
 * a partir de los marcadores ya cargados, de forma automática y dinámica.
 *
 * Reglas de negocio:
 *   - Un grupo se procesa solo cuando TODOS sus partidos están finalizados.
 *   - Al cerrar un grupo: se escriben las posiciones 1 y 2 (key `GRUPO:1`, `GRUPO:2`).
 *   - Las posiciones 3 (mejores terceros) SOLO se escriben cuando los 12 grupos
 *     están cerrados y se conocen los 8 mejores terceros.
 *   - Si una posición no se puede resolver (empate sin desempate posible), NO se
 *     escribe esa fila: queda para resolución manual vía /api/admin/results.
 *
 * El cálculo puro vive en lib/standings.ts. Aquí solo hay I/O con Supabase.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import {
  computeGroupStandings,
  computeBestThirds,
  type StandingMatch,
  type StandingTeam,
  type ThirdPlaceTeam,
} from '@/lib/standings'

type Db = ReturnType<typeof createAdminClient>

const GRUPOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const

export interface SyncQualifyResult {
  /** true si se escribió/actualizó al menos una fila official_results. */
  changed: boolean
  /** Claves (GRUPO:POS) que quedaron sin resolver por empate. */
  unresolved: string[]
  /** Grupos detectados como cerrados. */
  closedGroups: string[]
}

interface MatchRow {
  grupo: string | null
  equipo_local_id: string
  equipo_visitante_id: string
  goles_local: number | null
  goles_visitante: number | null
  estado: string
}

interface TeamRow {
  id: string
  nombre: string
  grupo: string
}

/**
 * Recalcula las posiciones oficiales de grupos a partir de los marcadores.
 * Idempotente: correrla varias veces produce el mismo estado.
 */
export async function syncQualifyFromResults(db: Db): Promise<SyncQualifyResult> {
  const result: SyncQualifyResult = { changed: false, unresolved: [], closedGroups: [] }

  const [{ data: matchesData }, { data: teamsData }] = await Promise.all([
    db
      .from('matches')
      .select('grupo, equipo_local_id, equipo_visitante_id, goles_local, goles_visitante, estado')
      .eq('fase', 'grupos'),
    db.from('teams').select('id, nombre, grupo'),
  ])

  const matches = (matchesData ?? []) as MatchRow[]
  const teams = (teamsData ?? []) as TeamRow[]
  if (matches.length === 0 || teams.length === 0) return result

  // Indexar por grupo
  const teamsByGroup = new Map<string, StandingTeam[]>()
  for (const t of teams) {
    const list = teamsByGroup.get(t.grupo) ?? []
    list.push({ teamId: t.id, teamNombre: t.nombre, grupo: t.grupo })
    teamsByGroup.set(t.grupo, list)
  }

  const matchesByGroup = new Map<string, MatchRow[]>()
  for (const m of matches) {
    if (!m.grupo) continue
    const list = matchesByGroup.get(m.grupo) ?? []
    list.push(m)
    matchesByGroup.set(m.grupo, list)
  }

  // Filas qualify a escribir (upsert) y el tercero de cada grupo cerrado
  const upserts: { scope: 'qualify'; key: string; value: { team: string } }[] = []
  const thirdsByGroup = new Map<string, ThirdPlaceTeam>()

  for (const grupo of GRUPOS) {
    const groupMatches = matchesByGroup.get(grupo) ?? []
    const groupTeams = teamsByGroup.get(grupo) ?? []
    if (groupTeams.length === 0 || groupMatches.length === 0) continue

    // Grupo cerrado: todos sus partidos finalizados con marcador
    const closed = groupMatches.every(
      (m) => m.estado === 'finished' && m.goles_local !== null && m.goles_visitante !== null,
    )
    if (!closed) continue
    result.closedGroups.push(grupo)

    const standingMatches: StandingMatch[] = groupMatches.map((m) => ({
      equipoLocalId: m.equipo_local_id,
      equipoVisitanteId: m.equipo_visitante_id,
      golesLocal: m.goles_local as number,
      golesVisitante: m.goles_visitante as number,
    }))

    const { rows } = computeGroupStandings(standingMatches, groupTeams)

    const primero = rows.find((r) => r.posicion === 1)
    const segundo = rows.find((r) => r.posicion === 2)
    const tercero = rows.find((r) => r.posicion === 3)

    if (primero) upserts.push({ scope: 'qualify', key: `${grupo}:1`, value: { team: primero.teamNombre } })
    else result.unresolved.push(`${grupo}:1`)

    if (segundo) upserts.push({ scope: 'qualify', key: `${grupo}:2`, value: { team: segundo.teamNombre } })
    else result.unresolved.push(`${grupo}:2`)

    if (tercero) {
      thirdsByGroup.set(grupo, {
        teamId: tercero.teamId,
        teamNombre: tercero.teamNombre,
        grupo,
        pts: tercero.pts,
        gd: tercero.gd,
        gf: tercero.gf,
      })
    } else {
      result.unresolved.push(`${grupo}:3`)
    }
  }

  // Mejores terceros: solo cuando los 12 grupos están cerrados y todos tienen 3º resuelto
  const allClosed = result.closedGroups.length === GRUPOS.length
  if (allClosed && thirdsByGroup.size === GRUPOS.length) {
    const { qualified, unresolved } = computeBestThirds([...thirdsByGroup.values()])
    if (unresolved) result.unresolved.push('mejores-terceros')
    for (const t of qualified) {
      upserts.push({ scope: 'qualify', key: `${t.grupo}:3`, value: { team: t.teamNombre } })
    }
  }

  if (upserts.length > 0) {
    const { error } = await db
      .from('official_results')
      .upsert(upserts, { onConflict: 'scope,key' })
    if (error) throw new Error(`official_results upsert (autoQualify): ${error.message}`)
    result.changed = true
  }

  if (result.unresolved.length > 0) {
    console.warn('[autoQualify] posiciones sin resolver (resolver manualmente):', result.unresolved)
  }

  return result
}
