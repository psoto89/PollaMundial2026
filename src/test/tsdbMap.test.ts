/**
 * Tests del cruce TheSportsDB ↔ BD (orientación de marcadores).
 * Bug: el Excel y TheSportsDB no coinciden en quién es local/visitante.
 * Correr con: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { teamPairKey, orientScores, tsdbTeamToDb } from '@/config/theSportsDbMap'

describe('teamPairKey', () => {
  it('es independiente del orden local/visitante', () => {
    expect(teamPairKey('Suiza', 'Catar')).toBe(teamPairKey('Catar', 'Suiza'))
  })

  it('colisiona el caso real Suiza/Catar vs Qatar/Switzerland', () => {
    // BD: "Suiza vs Catar" — TheSportsDB: "Qatar vs Switzerland"
    const ourKey = teamPairKey('Suiza', 'Catar')
    const tsdbKey = teamPairKey(tsdbTeamToDb('Qatar'), tsdbTeamToDb('Switzerland'))
    expect(tsdbKey).toBe(ourKey)
  })

  it('normaliza variantes (canada → Canadá) al cruzar', () => {
    expect(teamPairKey('Canadá', 'Bosnia')).toBe(teamPairKey('canada', 'Bosnia'))
  })
})

describe('orientScores', () => {
  it('orden directo: local TheSportsDB = local BD → sin swap', () => {
    // BD: Canadá(local) vs Bosnia — TheSportsDB: Canada 1-1 Bosnia
    const r = orientScores(tsdbTeamToDb('Canada'), 'Canadá', 1, 1)
    expect(r).toEqual({ goles_local: 1, goles_visitante: 1 })
  })

  it('orden invertido: hace swap del marcador', () => {
    // BD: Suiza(local) vs Catar — TheSportsDB: Qatar 1-0 Switzerland
    // Qatar(local TheSportsDB) ≠ Suiza(local BD) → swap: Suiza 0, Catar 1
    const r = orientScores(tsdbTeamToDb('Qatar'), 'Suiza', 1, 0)
    expect(r).toEqual({ goles_local: 0, goles_visitante: 1 })
  })

  it('empate invertido sigue siendo empate', () => {
    const r = orientScores(tsdbTeamToDb('Qatar'), 'Suiza', 1, 1)
    expect(r).toEqual({ goles_local: 1, goles_visitante: 1 })
  })

  it('propaga null (sin marcador aún)', () => {
    const r = orientScores(tsdbTeamToDb('Qatar'), 'Suiza', null, null)
    expect(r).toEqual({ goles_local: null, goles_visitante: null })
  })
})
