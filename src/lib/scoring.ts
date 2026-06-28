/**
 * lib/scoring.ts
 * Núcleo determinista de cálculo de puntos.
 * Todas las funciones son puras: mismos inputs → mismo output.
 * Testear con vitest antes de integrar.
 */

import type {
  DesglosePuntos,
  DesgloseClasificados,
  DesgloseSemis,
  DesglosePreguntas,
  Totales,
  Puesto,
  PreguntaKey,
} from '@/types'

// ─── Fase de grupos ───────────────────────────────────────────────────────────

export interface GroupMatchPred {
  predLocal: number
  predVisitante: number
}

export interface GroupMatchResult {
  golesLocal: number
  golesVisitante: number
}

/**
 * Calcula puntos por un partido de fase de grupos.
 *
 * Reglas:
 *   - Acertar el signo (1 = local gana, X = empate, 2 = visitante gana): +2 pts
 *   - Si además el marcador exacto coincide: +3 pts adicionales (total 5)
 */
export function scoreGroupMatch(
  pred: GroupMatchPred,
  result: GroupMatchResult,
): DesglosePuntos {
  // Resultado oficial aún no disponible → 0
  if (result.golesLocal === null || result.golesVisitante === null) {
    return { signo: 0, exacto: 0, total: 0 }
  }

  const signoReal = getSign(result.golesLocal, result.golesVisitante)
  const signoPred = getSign(pred.predLocal, pred.predVisitante)

  const signo = signoPred === signoReal ? 2 : 0
  const exacto =
    signo === 2 &&
    pred.predLocal === result.golesLocal &&
    pred.predVisitante === result.golesVisitante
      ? 3
      : 0

  return { signo, exacto, total: signo + exacto }
}

function getSign(local: number, visitante: number): '1' | 'X' | '2' {
  if (local > visitante) return '1'
  if (local < visitante) return '2'
  return 'X'
}

// ─── Clasificados a dieciseisavos ─────────────────────────────────────────────

export interface QualifyPred {
  grupo: string
  posicion: 1 | 2 | 3
  teamNombre: string
}

export interface QualifyOfficial {
  /** Mapa: teamNombre → posición real en el grupo (1 o 2).
   *  Los mejores terceros (pos 3) se listan en bestThirds.
   */
  classified: Record<string, { grupo: string; posicion: 1 | 2 }>
  bestThirds: string[] // nombres de los 8 mejores terceros (sin posición exacta)
}

/**
 * Calcula puntos de la sección "clasificados a dieciseisavos".
 *
 * Regla simétrica para las tres posiciones (1º, 2º y mejor tercero):
 *   - Por cada equipo que efectivamente clasificó (en CUALQUIER posición: 1, 2 o
 *     mejor tercero) y que el participante pronosticó como clasificado: +4 pts
 *   - Si además la posición pronosticada coincide exactamente con la real
 *     (1=1, 2=2, 3=3): +4 pts adicionales (total 8)
 *
 * Ejemplos:
 *   - Pronostica 3º y queda 3º (mejor tercero) → 8
 *   - Pronostica 3º y queda 2º → 4 (clasificó, pero otra posición)
 *   - Pronostica 2º y queda mejor tercero → 4
 *   - No clasificó → 0
 */
export function scoreQualify(
  preds: QualifyPred[],
  official: QualifyOfficial,
): DesgloseClasificados {
  let clasificado = 0
  let posicion = 0

  // Mapa unificado normalizado: equipo → posición REAL en la que clasificó (1, 2 o 3).
  // Normalizado (sin acentos/mayúsculas/espacios) para tolerar diferencias de nombre.
  const actualPos = new Map<string, 1 | 2 | 3>()
  for (const [team, entry] of Object.entries(official.classified)) {
    actualPos.set(normalizeText(team), entry.posicion)
  }
  for (const team of official.bestThirds) {
    actualPos.set(normalizeText(team), 3)
  }

  for (const pred of preds) {
    const real = actualPos.get(normalizeText(pred.teamNombre))
    if (real === undefined) continue // el equipo no clasificó
    clasificado += 4
    if (real === pred.posicion) posicion += 4 // posición exacta (incluido 3º)
  }

  return { clasificado, posicion, total: clasificado + posicion }
}

// ─── Semifinales / puestos finales ────────────────────────────────────────────

export interface SemisPred {
  puesto: Puesto
  teamNombre: string
}

export interface SemisOfficial {
  /** Los 4 equipos que llegaron a semifinales (independientemente del puesto final) */
  semifinalistas: string[]
  /** Puesto exacto de cada equipo */
  puestosExactos: Record<Puesto, string>
}

/** Puntos adicionales por acertar el puesto final exacto */
const BONUS_PUESTO: Record<Puesto, number> = {
  campeon:    20,
  subcampeon: 15,
  '3':        12,
  '4':        10,
}

/**
 * Calcula puntos de la sección "semifinales / puestos finales".
 *
 * Reglas:
 *   - Por cada pick (campeón/sub/3/4) cuyo equipo esté entre los 4 semifinalistas reales: +10 pts
 *   - Si además el puesto pronosticado coincide exactamente: +20/15/12/10 pts
 */
export function scoreSemis(
  preds: SemisPred[],
  official: SemisOfficial,
): DesgloseSemis {
  let semifinalista = 0
  let puestoExacto = 0

  // Normalizar ambos lados para tolerar diferencias de acentos/mayúsculas.
  const semifinalistasNorm = new Set(official.semifinalistas.map(normalizeText))
  const puestosExactosNorm = {} as Record<Puesto, string>
  for (const [puesto, team] of Object.entries(official.puestosExactos)) {
    puestosExactosNorm[puesto as Puesto] = normalizeText(team)
  }

  for (const pred of preds) {
    const normTeam = normalizeText(pred.teamNombre)
    const esSemifinalista = semifinalistasNorm.has(normTeam)
    if (esSemifinalista) {
      semifinalista += 10
      if (puestosExactosNorm[pred.puesto] === normTeam) {
        puestoExacto += BONUS_PUESTO[pred.puesto]
      }
    }
  }

  return { semifinalista, puestoExacto, total: semifinalista + puestoExacto }
}

// ─── Preguntas ────────────────────────────────────────────────────────────────

export interface QuestionPred {
  key: PreguntaKey
  respuesta: string | number | null
}

export interface QuestionOfficial {
  respuestas: Record<PreguntaKey, string | number | null>
}

/**
 * Calcula puntos de las 6 preguntas: +7 por cada acierto.
 *
 * Comparación normalizada:
 *   - Strings: trim + lowercase (insensible a mayúsculas y espacios externos)
 *   - Números: igualdad numérica (7 === 7, "7" === 7)
 */
export function scoreQuestions(
  preds: QuestionPred[],
  official: QuestionOfficial,
): DesglosePreguntas {
  let acertadas = 0

  for (const pred of preds) {
    const respOficial = official.respuestas[pred.key]
    if (respOficial === null || respOficial === undefined) continue
    if (pred.respuesta === null || pred.respuesta === undefined) continue

    if (answersMatch(pred.respuesta, respOficial)) {
      acertadas++
    }
  }

  return { acertadas, total: acertadas * 7 }
}

function normalizeText(s: string | number): string {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos: ñ→n, é→e, etc.
}

export function answersMatch(
  a: string | number,
  b: string | number,
): boolean {
  // Intentar comparación numérica primero
  const na = Number(a)
  const nb = Number(b)
  if (!isNaN(na) && !isNaN(nb)) return na === nb

  // Comparación textual normalizada (sin acentos, sin mayúsculas)
  const na2 = normalizeText(a)
  const nb2 = normalizeText(b)
  if (na2 === nb2) return true

  // Comparación de contenido: "Quiñones" matchea "Julián Quiñones"
  // Solo aplica si ambas tienen al menos 3 caracteres (evitar falsos positivos)
  if (na2.length >= 3 && nb2.length >= 3) {
    return na2.includes(nb2) || nb2.includes(na2)
  }

  return false
}

// ─── Totales por participante ─────────────────────────────────────────────────

export interface AllGroupPreds {
  matchIndex: number
  predLocal: number
  predVisitante: number
}

export interface AllGroupResults {
  matchIndex: number
  golesLocal: number | null
  golesVisitante: number | null
}

/**
 * Calcula el total de puntos en fase de grupos para un participante.
 */
export function computeGrupoTotal(
  preds: AllGroupPreds[],
  results: AllGroupResults[],
): number {
  const resultMap = new Map(results.map((r) => [r.matchIndex, r]))
  let total = 0

  for (const pred of preds) {
    const result = resultMap.get(pred.matchIndex)
    if (!result || result.golesLocal === null || result.golesVisitante === null) continue
    const score = scoreGroupMatch(
      { predLocal: pred.predLocal, predVisitante: pred.predVisitante },
      { golesLocal: result.golesLocal, golesVisitante: result.golesVisitante },
    )
    total += score.total
  }

  return total
}

/**
 * Agrega todos los subtotales en la estructura de scores_cache.
 */
export function computeTotals(params: {
  grupos: number
  clasificados: number
  semis: number
  preguntas: number
}): Totales {
  return {
    grupos: params.grupos,
    clasificados: params.clasificados,
    semis: params.semis,
    preguntas: params.preguntas,
    total: params.grupos + params.clasificados + params.semis + params.preguntas,
  }
}
