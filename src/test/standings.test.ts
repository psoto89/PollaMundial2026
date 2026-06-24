/**
 * Tests de standings.ts
 * Cubren cálculo de tabla de posiciones (desempate FIFA) y mejores terceros.
 * Correr con: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  computeGroupStandings,
  computeBestThirds,
  type StandingMatch,
  type StandingTeam,
  type ThirdPlaceTeam,
} from '@/lib/standings'

// 4 equipos de un grupo
const TEAMS: StandingTeam[] = [
  { teamId: 'a', teamNombre: 'Argentina', grupo: 'A' },
  { teamId: 'b', teamNombre: 'Brasil', grupo: 'A' },
  { teamId: 'c', teamNombre: 'Colombia', grupo: 'A' },
  { teamId: 'd', teamNombre: 'Dinamarca', grupo: 'A' },
]

/** Helper para construir un partido. */
function match(local: string, gl: number, visita: string, gv: number): StandingMatch {
  return { equipoLocalId: local, golesLocal: gl, equipoVisitanteId: visita, golesVisitante: gv }
}

function posOf(rows: { teamId: string; posicion: number | null }[], teamId: string) {
  return rows.find((r) => r.teamId === teamId)?.posicion
}

describe('computeGroupStandings', () => {
  it('orden claro por puntos', () => {
    // a gana todo, b gana 2, c gana 1, d pierde todo
    const matches = [
      match('a', 2, 'b', 0),
      match('a', 1, 'c', 0),
      match('a', 3, 'd', 0),
      match('b', 2, 'c', 0),
      match('b', 1, 'd', 0),
      match('c', 1, 'd', 0),
    ]
    const { rows, unresolved } = computeGroupStandings(matches, TEAMS)
    expect(unresolved).toBe(false)
    expect(posOf(rows, 'a')).toBe(1) // 9 pts
    expect(posOf(rows, 'b')).toBe(2) // 6 pts
    expect(posOf(rows, 'c')).toBe(3) // 3 pts
    expect(posOf(rows, 'd')).toBe(4) // 0 pts
  })

  it('desempate por diferencia de goles', () => {
    // a y b ambos 7 pts; a con mejor diferencia de goles
    const matches = [
      match('a', 5, 'd', 0), // a +5
      match('b', 1, 'c', 0), // b +1
      match('a', 0, 'b', 0), // empate entre a y b
      match('a', 1, 'c', 0),
      match('b', 1, 'd', 0),
      match('c', 2, 'd', 0), // c vence a d → los distingue del fondo
    ]
    const { rows, unresolved } = computeGroupStandings(matches, TEAMS)
    // a: 5-0 d (W), 0-0 b (D), 1-0 c (W) → 7 pts, GD +6
    // b: 1-0 c (W), 0-0 a (D), 1-0 d (W) → 7 pts, GD +2
    // c: 3 pts; d: 0 pts
    expect(unresolved).toBe(false)
    expect(posOf(rows, 'a')).toBe(1)
    expect(posOf(rows, 'b')).toBe(2)
    expect(posOf(rows, 'c')).toBe(3)
    expect(posOf(rows, 'd')).toBe(4)
  })

  it('desempate por goles a favor (misma dif)', () => {
    // a y b: mismos pts, misma diferencia; a marca más goles
    const matches = [
      match('a', 3, 'c', 1), // a gd+2, gf3
      match('b', 2, 'c', 0), // b gd+2, gf2
      match('a', 0, 'b', 0),
      match('a', 0, 'd', 1), // a pierde con d
      match('b', 0, 'd', 1), // b pierde con d
      match('c', 0, 'd', 0),
    ]
    const { rows } = computeGroupStandings(matches, TEAMS)
    // a: 4 pts, gf3 gc2 gd+1 ; b: 4 pts, gf2 gc1 gd+1 ; d: 7 pts (1º) ; c: 1 pt
    // a y b empatan pts y gd; a tiene más gf → a antes que b
    expect(posOf(rows, 'd')).toBe(1)
    expect(posOf(rows, 'a')).toBeLessThan(posOf(rows, 'b') as number)
  })

  it('desempate por head-to-head cuando pts/dif/gf coinciden', () => {
    // a y b idénticos en general (6 pts, gf3, gc1, gd+2); a le ganó a b 1-0
    const matches = [
      match('a', 1, 'b', 0), // directo: a gana
      match('a', 2, 'c', 0),
      match('a', 0, 'd', 1), // a pierde con d
      match('b', 1, 'c', 0),
      match('b', 2, 'd', 0),
      match('c', 0, 'd', 0),
    ]
    const { rows, unresolved } = computeGroupStandings(matches, TEAMS)
    // a: 1-0 b (W), 2-0 c (W), 0-1 d (L) → 6 pts, gf3 gc1 gd+2
    // b: 0-1 a (L), 1-0 c (W), 2-0 d (W) → 6 pts, gf3 gc1 gd+2
    // empate general total; head-to-head: a venció a b → a primero
    expect(unresolved).toBe(false)
    expect(posOf(rows, 'a')).toBe(1)
    expect(posOf(rows, 'b')).toBe(2)
  })

  it('empate total irresoluble → posiciones null', () => {
    // a y b idénticos en general y empatan el directo 0-0
    const matches = [
      match('a', 0, 'b', 0), // directo empatado
      match('a', 1, 'c', 0),
      match('a', 0, 'd', 1),
      match('b', 1, 'c', 0),
      match('b', 0, 'd', 1),
      match('c', 0, 'd', 0),
    ]
    const { rows, unresolved } = computeGroupStandings(matches, TEAMS)
    // a: 0-0 b, 1-0 c (W), 0-1 d (L) → 4 pts, gf1 gc1 gd0
    // b: 0-0 a, 1-0 c (W), 0-1 d (L) → 4 pts, gf1 gc1 gd0
    // d: 1-0 a, 1-0 b, 0-0 c → 7 pts (1º) ; c: 1 pt (4º)
    expect(unresolved).toBe(true)
    expect(posOf(rows, 'd')).toBe(1)
    expect(posOf(rows, 'a')).toBeNull()
    expect(posOf(rows, 'b')).toBeNull()
  })
})

describe('computeBestThirds', () => {
  function third(id: string, pts: number, gd: number, gf: number): ThirdPlaceTeam {
    return { teamId: id, teamNombre: id, grupo: id.toUpperCase(), pts, gd, gf }
  }

  it('selecciona los 8 mejores de 12 por pts/dif/gf', () => {
    const thirds = [
      third('g1', 6, 5, 8),
      third('g2', 6, 3, 6),
      third('g3', 5, 2, 5),
      third('g4', 4, 1, 4),
      third('g5', 4, 0, 3),
      third('g6', 4, 0, 2),
      third('g7', 3, 1, 3),
      third('g8', 3, 0, 2),
      third('g9', 2, -1, 2), // queda fuera
      third('g10', 1, -3, 1),
      third('g11', 1, -4, 0),
      third('g12', 0, -6, 0),
    ]
    const { qualified, unresolved } = computeBestThirds(thirds)
    expect(unresolved).toBe(false)
    expect(qualified).toHaveLength(8)
    const ids = qualified.map((t) => t.teamId)
    expect(ids).toContain('g8')
    expect(ids).not.toContain('g9')
  })

  it('empate en la frontera 8º/9º → solo clasifica a los inequívocos + unresolved', () => {
    const thirds = [
      third('g1', 9, 5, 9),
      third('g2', 7, 4, 7),
      third('g3', 6, 3, 6),
      third('g4', 5, 2, 5),
      third('g5', 4, 1, 4),
      third('g6', 4, 1, 3),
      third('g7', 3, 0, 3),
      third('g8', 2, 0, 2), // 8º
      third('g9', 2, 0, 2), // 9º — empate exacto con el 8º
      third('g10', 1, -2, 1),
      third('g11', 1, -3, 0),
      third('g12', 0, -5, 0),
    ]
    const { qualified, unresolved } = computeBestThirds(thirds)
    expect(unresolved).toBe(true)
    // Los 7 estrictamente mejores que la clave de corte (2,0,2) clasifican; g8/g9 quedan a resolver
    expect(qualified).toHaveLength(7)
    const ids = qualified.map((t) => t.teamId)
    expect(ids).not.toContain('g8')
    expect(ids).not.toContain('g9')
  })

  it('si hay 8 o menos terceros, clasifican todos', () => {
    const thirds = [
      third('g1', 6, 5, 8),
      third('g2', 4, 1, 4),
    ]
    const { qualified, unresolved } = computeBestThirds(thirds)
    expect(unresolved).toBe(false)
    expect(qualified).toHaveLength(2)
  })
})
