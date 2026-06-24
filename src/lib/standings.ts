/**
 * lib/standings.ts
 * Cálculo determinista de la tabla de posiciones de un grupo a partir de
 * los marcadores finales, y selección de los mejores terceros.
 *
 * Todas las funciones son puras: mismos inputs → mismo output.
 * Reglas de desempate FIFA 2026 (sin tarjetas ni sorteo, ver nota):
 *   1. Puntos (V=3, E=1, D=0)
 *   2. Diferencia de goles
 *   3. Goles a favor
 *   4. Resultados entre los equipos empatados (head-to-head): pts → dif → gf
 *   5. (Fair play y sorteo) → NO disponibles: la posición queda "no resuelta".
 *
 * Testear con vitest antes de integrar.
 */

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface StandingMatch {
  equipoLocalId: string
  equipoVisitanteId: string
  golesLocal: number
  golesVisitante: number
}

export interface StandingTeam {
  teamId: string
  teamNombre: string
  grupo: string
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface StandingRow {
  teamId: string
  teamNombre: string
  grupo: string
  pj: number
  pts: number
  gf: number
  gc: number
  gd: number
  /** Posición final 1..N, o null si un empate no se pudo resolver. */
  posicion: number | null
}

export interface GroupStandings {
  /** Filas ordenadas de mejor a peor. */
  rows: StandingRow[]
  /** true si alguna posición quedó sin resolver (empate irresoluble). */
  unresolved: boolean
}

// ─── Stats acumuladas (interno) ───────────────────────────────────────────────

interface Stats {
  pts: number
  gf: number
  gc: number
  pj: number
}

function emptyStats(): Stats {
  return { pts: 0, gf: 0, gc: 0, pj: 0 }
}

/** Acumula stats de un set de partidos para un conjunto de equipos dado. */
function accumulate(
  matches: StandingMatch[],
  teamIds: Set<string>,
): Map<string, Stats> {
  const stats = new Map<string, Stats>()
  for (const id of teamIds) stats.set(id, emptyStats())

  for (const m of matches) {
    // Solo contar partidos entre equipos del conjunto considerado
    if (!teamIds.has(m.equipoLocalId) || !teamIds.has(m.equipoVisitanteId)) continue

    const local = stats.get(m.equipoLocalId)!
    const visita = stats.get(m.equipoVisitanteId)!

    local.gf += m.golesLocal
    local.gc += m.golesVisitante
    local.pj += 1
    visita.gf += m.golesVisitante
    visita.gc += m.golesLocal
    visita.pj += 1

    if (m.golesLocal > m.golesVisitante) {
      local.pts += 3
    } else if (m.golesLocal < m.golesVisitante) {
      visita.pts += 3
    } else {
      local.pts += 1
      visita.pts += 1
    }
  }

  return stats
}

/** Clave de ordenamiento general: [pts, dif. goles, goles a favor]. */
function overallKey(s: Stats): [number, number, number] {
  return [s.pts, s.gf - s.gc, s.gf]
}

function keyEquals(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** Compara dos claves desc: >0 si a va antes que b. */
function keyCompare(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return b[0] - a[0]
  if (a[1] !== b[1]) return b[1] - a[1]
  return b[2] - a[2]
}

/**
 * Calcula la tabla de posiciones de un grupo.
 * `matches` deben ser los partidos del grupo con marcadores finales (no nulos).
 * `teams` son los equipos del grupo.
 */
export function computeGroupStandings(
  matches: StandingMatch[],
  teams: StandingTeam[],
): GroupStandings {
  const teamIds = new Set(teams.map((t) => t.teamId))
  const overall = accumulate(matches, teamIds)

  // Orden general por pts → dif → gf
  const sorted = [...teams].sort((a, b) =>
    keyCompare(overallKey(overall.get(a.teamId)!), overallKey(overall.get(b.teamId)!)),
  )

  // Resolver empates dentro de cada banda con la misma clave general (head-to-head)
  // Devuelve, para cada equipo, una "clave de desempate" h2h dentro de su banda.
  const h2hKey = new Map<string, [number, number, number]>()
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    const bandKey = overallKey(overall.get(sorted[i].teamId)!)
    while (j < sorted.length && keyEquals(overallKey(overall.get(sorted[j].teamId)!), bandKey)) {
      j++
    }
    const band = sorted.slice(i, j)
    if (band.length > 1) {
      const bandIds = new Set(band.map((t) => t.teamId))
      const h2h = accumulate(matches, bandIds)
      for (const t of band) h2hKey.set(t.teamId, overallKey(h2h.get(t.teamId)!))
      // Reordenar la banda por su mini-tabla h2h
      band.sort((a, b) => keyCompare(h2hKey.get(a.teamId)!, h2hKey.get(b.teamId)!))
      for (let k = 0; k < band.length; k++) sorted[i + k] = band[k]
    } else {
      h2hKey.set(band[0].teamId, [0, 0, 0])
    }
    i = j
  }

  // Asignar posiciones; null cuando un cluster adyacente es indistinguible
  let unresolved = false
  const posiciones = new Array<number | null>(sorted.length)
  i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && !distinguishable(sorted[i], sorted[j], overall, h2hKey)) {
      j++
    }
    if (j - i === 1) {
      posiciones[i] = i + 1
    } else {
      // Cluster de empate irresoluble → todas sus posiciones quedan null
      unresolved = true
      for (let k = i; k < j; k++) posiciones[k] = null
    }
    i = j
  }

  const rows: StandingRow[] = sorted.map((t, idx) => {
    const s = overall.get(t.teamId)!
    return {
      teamId: t.teamId,
      teamNombre: t.teamNombre,
      grupo: t.grupo,
      pj: s.pj,
      pts: s.pts,
      gf: s.gf,
      gc: s.gc,
      gd: s.gf - s.gc,
      posicion: posiciones[idx],
    }
  })

  return { rows, unresolved }
}

/**
 * Dos equipos son distinguibles si nuestros criterios los ordenan estrictamente.
 * Mismo overall key y mismo h2h key → indistinguibles (no hay fair play/sorteo).
 */
function distinguishable(
  a: StandingTeam,
  b: StandingTeam,
  overall: Map<string, Stats>,
  h2hKey: Map<string, [number, number, number]>,
): boolean {
  const ka = overallKey(overall.get(a.teamId)!)
  const kb = overallKey(overall.get(b.teamId)!)
  if (!keyEquals(ka, kb)) return true
  return !keyEquals(h2hKey.get(a.teamId)!, h2hKey.get(b.teamId)!)
}

// ─── Mejores terceros ─────────────────────────────────────────────────────────

export interface ThirdPlaceTeam {
  teamId: string
  teamNombre: string
  grupo: string
  pts: number
  gd: number
  gf: number
}

export interface BestThirdsResult {
  /** Terceros que clasifican (hasta `cantidad`, normalmente 8). */
  qualified: ThirdPlaceTeam[]
  /** true si el corte quedó en un empate irresoluble por pts/dif/gf. */
  unresolved: boolean
}

/**
 * Selecciona los mejores terceros (por defecto 8 de 12) por pts → dif → gf.
 * Si el corte cae en un empate (mismos pts/dif/gf entre el último que entra y
 * el primero que queda fuera) → devuelve solo los inequívocamente clasificados
 * y marca `unresolved` para resolución manual.
 */
export function computeBestThirds(
  thirds: ThirdPlaceTeam[],
  cantidad = 8,
): BestThirdsResult {
  const sorted = [...thirds].sort((a, b) =>
    keyCompare([a.pts, a.gd, a.gf], [b.pts, b.gd, b.gf]),
  )

  if (sorted.length <= cantidad) {
    return { qualified: sorted, unresolved: false }
  }

  const cutKey: [number, number, number] = [
    sorted[cantidad - 1].pts,
    sorted[cantidad - 1].gd,
    sorted[cantidad - 1].gf,
  ]
  const firstOutKey: [number, number, number] = [
    sorted[cantidad].pts,
    sorted[cantidad].gd,
    sorted[cantidad].gf,
  ]

  // Sin empate en la frontera: corte limpio
  if (!keyEquals(cutKey, firstOutKey)) {
    return { qualified: sorted.slice(0, cantidad), unresolved: false }
  }

  // Empate en la frontera: clasificar solo los estrictamente mejores que la clave de corte.
  // keyCompare(x, cut) < 0 ⇒ x ordena antes que cut ⇒ x es estrictamente mejor.
  const safe = sorted.filter((t) => keyCompare([t.pts, t.gd, t.gf], cutKey) < 0)
  return { qualified: safe, unresolved: true }
}
