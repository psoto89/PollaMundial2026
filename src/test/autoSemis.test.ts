import { describe, it, expect } from 'vitest'
import { computeSemisRows, type KnockoutRow } from '@/lib/autoSemis'

// Helpers para construir filas de partido knockout con menos ruido.
function sf(local: string, visitante: string, extra: Partial<KnockoutRow> = {}): KnockoutRow {
  return {
    fase: 'semis', bracket_slot: null, estado: 'scheduled',
    goles_local: null, goles_visitante: null, advancer_team_id: null,
    equipo_local_id: local, equipo_visitante_id: visitante, ...extra,
  }
}
function match(fase: string, over: Partial<KnockoutRow>): KnockoutRow {
  return {
    fase, bracket_slot: null, estado: 'scheduled',
    goles_local: null, goles_visitante: null, advancer_team_id: null,
    equipo_local_id: null, equipo_visitante_id: null, ...over,
  }
}

const names = new Map([
  ['arg', 'Argentina'], ['eng', 'Inglaterra'], ['esp', 'España'], ['fra', 'Francia'],
])

describe('computeSemisRows', () => {
  it('sin partidos de semis → phase none, sin filas', () => {
    const { rows, phase } = computeSemisRows([], names)
    expect(phase).toBe('none')
    expect(rows).toHaveLength(0)
  })

  it('semis creadas (aún sin jugar) → 4 semifinalistas bajo sf1..sf4', () => {
    const matches = [sf('arg', 'eng'), sf('esp', 'fra')]
    const { rows, phase } = computeSemisRows(matches, names)
    expect(phase).toBe('semis')
    expect(rows.map((r) => r.key)).toEqual(['sf1', 'sf2', 'sf3', 'sf4'])
    expect(rows.map((r) => r.value.team).sort()).toEqual(
      ['Argentina', 'España', 'Francia', 'Inglaterra'],
    )
  })

  it('detecta semis también por bracket_slot SF-*', () => {
    const matches = [
      sf('arg', 'eng', { fase: 'otro', bracket_slot: 'SF-1' }),
      sf('esp', 'fra', { fase: 'otro', bracket_slot: 'SF-2' }),
    ]
    const { rows, phase } = computeSemisRows(matches, names)
    expect(phase).toBe('semis')
    expect(rows).toHaveLength(4)
  })

  it('semis jugadas pero final aún pendiente → sigue en fase semis (solo +10)', () => {
    const matches = [
      sf('arg', 'eng', { estado: 'finished', goles_local: 1, goles_visitante: 0 }),
      sf('esp', 'fra', { estado: 'finished', goles_local: 2, goles_visitante: 1 }),
      // Final creada pero no jugada
      match('final', { equipo_local_id: 'arg', equipo_visitante_id: 'esp' }),
    ]
    const { phase } = computeSemisRows(matches, names)
    expect(phase).toBe('semis')
  })

  it('final y 3er puesto finalizados → puestos con claves campeon/sub/3/4', () => {
    const matches = [
      sf('arg', 'eng', { estado: 'finished', goles_local: 1, goles_visitante: 0 }),
      sf('esp', 'fra', { estado: 'finished', goles_local: 2, goles_visitante: 1 }),
      match('final', { estado: 'finished', equipo_local_id: 'arg', equipo_visitante_id: 'esp', goles_local: 3, goles_visitante: 1 }),
      match('tercer_puesto', { estado: 'finished', equipo_local_id: 'eng', equipo_visitante_id: 'fra', goles_local: 0, goles_visitante: 2 }),
    ]
    const { rows, phase } = computeSemisRows(matches, names)
    expect(phase).toBe('final')
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value.team]))
    expect(byKey).toEqual({
      campeon: 'Argentina',    // ganó la final 3-1
      subcampeon: 'España',    // perdió la final
      '3': 'Francia',          // ganó el 3er puesto 2-0
      '4': 'Inglaterra',       // perdió el 3er puesto
    })
  })

  it('final empatada a 120 usa el advancer explícito (penales)', () => {
    const matches = [
      sf('arg', 'eng', { estado: 'finished', goles_local: 1, goles_visitante: 0 }),
      sf('esp', 'fra', { estado: 'finished', goles_local: 2, goles_visitante: 1 }),
      match('final', { estado: 'finished', equipo_local_id: 'arg', equipo_visitante_id: 'esp', goles_local: 1, goles_visitante: 1, advancer_team_id: 'esp' }),
      match('tercer_puesto', { estado: 'finished', equipo_local_id: 'eng', equipo_visitante_id: 'fra', goles_local: 1, goles_visitante: 0 }),
    ]
    const { rows } = computeSemisRows(matches, names)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value.team]))
    expect(byKey.campeon).toBe('España')     // ganó por penales pese al 1-1
    expect(byKey.subcampeon).toBe('Argentina')
  })

  it('descarta equipos sin nombre en el mapa (id desconocido)', () => {
    const matches = [sf('arg', 'xxx'), sf('esp', 'fra')]
    const { rows } = computeSemisRows(matches, names)
    // 'xxx' no está en el mapa → se descarta
    expect(rows.map((r) => r.value.team).sort()).toEqual(['Argentina', 'España', 'Francia'])
  })
})
