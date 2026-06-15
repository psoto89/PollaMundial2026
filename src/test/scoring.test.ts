/**
 * Tests de scoring.ts
 * Cubren todas las reglas y casos borde del sistema de puntuación.
 * Correr con: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import {
  scoreGroupMatch,
  scoreQualify,
  scoreSemis,
  scoreQuestions,
  computeTotals,
} from '@/lib/scoring'

// ─── Fase de grupos ───────────────────────────────────────────────────────────

describe('scoreGroupMatch', () => {
  it('acierta signo (local gana) sin exacto → +2', () => {
    const r = scoreGroupMatch(
      { predLocal: 1, predVisitante: 0 },
      { golesLocal: 2, golesVisitante: 0 },
    )
    expect(r).toEqual({ signo: 2, exacto: 0, total: 2 })
  })

  it('acierta signo y marcador exacto → +5', () => {
    const r = scoreGroupMatch(
      { predLocal: 2, predVisitante: 1 },
      { golesLocal: 2, golesVisitante: 1 },
    )
    expect(r).toEqual({ signo: 2, exacto: 3, total: 5 })
  })

  it('acierta empate (X) sin exacto → +2', () => {
    const r = scoreGroupMatch(
      { predLocal: 1, predVisitante: 1 },
      { golesLocal: 2, golesVisitante: 2 },
    )
    expect(r).toEqual({ signo: 2, exacto: 0, total: 2 })
  })

  it('acierta empate exacto → +5', () => {
    const r = scoreGroupMatch(
      { predLocal: 0, predVisitante: 0 },
      { golesLocal: 0, golesVisitante: 0 },
    )
    expect(r).toEqual({ signo: 2, exacto: 3, total: 5 })
  })

  it('fallo total → 0', () => {
    const r = scoreGroupMatch(
      { predLocal: 2, predVisitante: 0 },
      { golesLocal: 0, golesVisitante: 1 },
    )
    expect(r).toEqual({ signo: 0, exacto: 0, total: 0 })
  })

  it('marcador exacto pero signo incorrecto → imposible (no ocurre por lógica)', () => {
    // Si el marcador exacto coincide, el signo también coincide por definición
    // Verificar que si el signo falla, exacto es 0
    const r = scoreGroupMatch(
      { predLocal: 0, predVisitante: 1 }, // visitante gana
      { golesLocal: 1, golesVisitante: 0 }, // local gana
    )
    expect(r.signo).toBe(0)
    expect(r.exacto).toBe(0)
  })

  it('visitante gana, acierta signo sin exacto → +2', () => {
    const r = scoreGroupMatch(
      { predLocal: 0, predVisitante: 2 },
      { golesLocal: 1, golesVisitante: 3 },
    )
    expect(r).toEqual({ signo: 2, exacto: 0, total: 2 })
  })

  it('visitante gana, marcador exacto → +5', () => {
    const r = scoreGroupMatch(
      { predLocal: 1, predVisitante: 3 },
      { golesLocal: 1, golesVisitante: 3 },
    )
    expect(r).toEqual({ signo: 2, exacto: 3, total: 5 })
  })
})

// ─── Clasificados ─────────────────────────────────────────────────────────────

describe('scoreQualify', () => {
  const official = {
    classified: {
      España:    { grupo: 'H', posicion: 1 as const },
      Argentina: { grupo: 'J', posicion: 2 as const },
      Brasil:    { grupo: 'C', posicion: 1 as const },
    },
    bestThirds: ['México', 'Francia', 'Alemania'],
  }

  it('acierta equipo y posición exacta → +8', () => {
    const r = scoreQualify(
      [{ grupo: 'H', posicion: 1, teamNombre: 'España' }],
      official,
    )
    expect(r).toEqual({ clasificado: 4, posicion: 4, total: 8 })
  })

  it('acierta equipo pero posición incorrecta → +4', () => {
    const r = scoreQualify(
      [{ grupo: 'J', posicion: 1, teamNombre: 'Argentina' }], // pronostica 1, es 2
      official,
    )
    expect(r).toEqual({ clasificado: 4, posicion: 0, total: 4 })
  })

  it('equipo no clasificado → 0', () => {
    const r = scoreQualify(
      [{ grupo: 'A', posicion: 1, teamNombre: 'Corea del Sur' }],
      official,
    )
    expect(r).toEqual({ clasificado: 0, posicion: 0, total: 0 })
  })

  it('mejor tercero acertado → +4 sin bonus posición', () => {
    const r = scoreQualify(
      [{ grupo: 'A', posicion: 3, teamNombre: 'México' }],
      official,
    )
    expect(r).toEqual({ clasificado: 4, posicion: 0, total: 4 })
  })

  it('mejor tercero NO en la lista → 0', () => {
    const r = scoreQualify(
      [{ grupo: 'A', posicion: 3, teamNombre: 'Japón' }],
      official,
    )
    expect(r).toEqual({ clasificado: 0, posicion: 0, total: 0 })
  })

  it('múltiples aciertos → suma correcta', () => {
    const r = scoreQualify(
      [
        { grupo: 'H', posicion: 1, teamNombre: 'España' },  // +4+4
        { grupo: 'C', posicion: 1, teamNombre: 'Brasil' },  // +4+4
        { grupo: 'A', posicion: 3, teamNombre: 'México' },  // +4
        { grupo: 'J', posicion: 2, teamNombre: 'Argentina'},// +4+4
        { grupo: 'B', posicion: 1, teamNombre: 'Japón' },   // 0
      ],
      official,
    )
    expect(r.total).toBe(28) // 8+8+4+8+0
  })

  it('pred vacía → 0', () => {
    const r = scoreQualify([], official)
    expect(r).toEqual({ clasificado: 0, posicion: 0, total: 0 })
  })
})

// ─── Semifinales ──────────────────────────────────────────────────────────────

describe('scoreSemis', () => {
  const official = {
    semifinalistas: ['España', 'Argentina', 'Francia', 'Brasil'],
    puestosExactos: {
      campeon:   'España',
      subcampeon:'Argentina',
      '3':       'Francia',
      '4':       'Brasil',
    } as Record<import('@/types').Puesto, string>,
  }

  it('acertó semifinalista y puesto exacto (campeón) → +10+20=30', () => {
    const r = scoreSemis(
      [{ puesto: 'campeon', teamNombre: 'España' }],
      official,
    )
    expect(r).toEqual({ semifinalista: 10, puestoExacto: 20, total: 30 })
  })

  it('acertó semifinalista y puesto exacto (subcampeón) → +10+15=25', () => {
    const r = scoreSemis(
      [{ puesto: 'subcampeon', teamNombre: 'Argentina' }],
      official,
    )
    expect(r).toEqual({ semifinalista: 10, puestoExacto: 15, total: 25 })
  })

  it('acertó semifinalista y puesto exacto (3er) → +10+12=22', () => {
    const r = scoreSemis([{ puesto: '3', teamNombre: 'Francia' }], official)
    expect(r).toEqual({ semifinalista: 10, puestoExacto: 12, total: 22 })
  })

  it('acertó semifinalista y puesto exacto (4to) → +10+10=20', () => {
    const r = scoreSemis([{ puesto: '4', teamNombre: 'Brasil' }], official)
    expect(r).toEqual({ semifinalista: 10, puestoExacto: 10, total: 20 })
  })

  it('acertó semifinalista pero puesto incorrecto → solo +10', () => {
    const r = scoreSemis(
      [{ puesto: 'campeon', teamNombre: 'Brasil' }], // Brasil fue 4to
      official,
    )
    expect(r).toEqual({ semifinalista: 10, puestoExacto: 0, total: 10 })
  })

  it('equipo no llegó a semis → 0', () => {
    const r = scoreSemis(
      [{ puesto: 'campeon', teamNombre: 'Alemania' }],
      official,
    )
    expect(r).toEqual({ semifinalista: 0, puestoExacto: 0, total: 0 })
  })

  it('los 4 picks acertados con puestos exactos → 10+20+10+15+10+12+10+10=97', () => {
    const r = scoreSemis(
      [
        { puesto: 'campeon',   teamNombre: 'España' },
        { puesto: 'subcampeon',teamNombre: 'Argentina' },
        { puesto: '3',         teamNombre: 'Francia' },
        { puesto: '4',         teamNombre: 'Brasil' },
      ],
      official,
    )
    // 4×10 (semifinalistas) + 20+15+12+10 (puestos exactos)
    expect(r.semifinalista).toBe(40)
    expect(r.puestoExacto).toBe(57)
    expect(r.total).toBe(97)
  })

  it('pred vacía → 0', () => {
    const r = scoreSemis([], official)
    expect(r).toEqual({ semifinalista: 0, puestoExacto: 0, total: 0 })
  })
})

// ─── Preguntas ────────────────────────────────────────────────────────────────

describe('scoreQuestions', () => {
  const official = {
    respuestas: {
      p1: 'Kane',
      p2: 'Kane',
      p3: 8,
      p4: 'Yamal',
      p5: 'España',
      p6: 3,
    } as Record<import('@/types').PreguntaKey, string | number | null>,
  }

  it('acertó texto exacto → +7', () => {
    const r = scoreQuestions(
      [{ key: 'p1', respuesta: 'Kane' }],
      official,
    )
    expect(r).toEqual({ acertadas: 1, total: 7 })
  })

  it('acertó texto case-insensitive → +7', () => {
    const r = scoreQuestions(
      [{ key: 'p2', respuesta: 'kane' }],
      official,
    )
    expect(r.total).toBe(7)
  })

  it('acertó número exacto (int) → +7', () => {
    const r = scoreQuestions(
      [{ key: 'p3', respuesta: 8 }],
      official,
    )
    expect(r.total).toBe(7)
  })

  it('acertó número como string → +7', () => {
    const r = scoreQuestions(
      [{ key: 'p6', respuesta: '3' }],
      official,
    )
    expect(r.total).toBe(7)
  })

  it('falló texto → 0', () => {
    const r = scoreQuestions(
      [{ key: 'p4', respuesta: 'Mbappe' }],
      official,
    )
    expect(r.total).toBe(0)
  })

  it('falló número → 0', () => {
    const r = scoreQuestions(
      [{ key: 'p3', respuesta: 7 }],
      official,
    )
    expect(r.total).toBe(0)
  })

  it('respuesta null → 0', () => {
    const r = scoreQuestions(
      [{ key: 'p1', respuesta: null }],
      official,
    )
    expect(r.total).toBe(0)
  })

  it('las 6 acertadas → 42', () => {
    const r = scoreQuestions(
      [
        { key: 'p1', respuesta: 'Kane' },
        { key: 'p2', respuesta: 'Kane' },
        { key: 'p3', respuesta: 8 },
        { key: 'p4', respuesta: 'Yamal' },
        { key: 'p5', respuesta: 'España' },
        { key: 'p6', respuesta: 3 },
      ],
      official,
    )
    expect(r).toEqual({ acertadas: 6, total: 42 })
  })

  it('3 acertadas → 21', () => {
    const r = scoreQuestions(
      [
        { key: 'p1', respuesta: 'Kane' },
        { key: 'p2', respuesta: 'Ronaldo' }, // fallo
        { key: 'p3', respuesta: 8 },
        { key: 'p4', respuesta: 'Messi' },   // fallo
        { key: 'p5', respuesta: 'España' },
        { key: 'p6', respuesta: 2 },          // fallo
      ],
      official,
    )
    expect(r).toEqual({ acertadas: 3, total: 21 })
  })
})

// ─── computeTotals ────────────────────────────────────────────────────────────

describe('computeTotals', () => {
  it('suma todos los subtotales correctamente', () => {
    const t = computeTotals({
      grupos: 40,
      clasificados: 32,
      semis: 57,
      preguntas: 21,
    })
    expect(t).toEqual({
      grupos: 40,
      clasificados: 32,
      semis: 57,
      preguntas: 21,
      total: 150,
    })
  })

  it('todos en cero → 0', () => {
    const t = computeTotals({ grupos: 0, clasificados: 0, semis: 0, preguntas: 0 })
    expect(t.total).toBe(0)
  })
})
