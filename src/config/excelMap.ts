// Mapeo completo del archivo Gran_Polla_Mundial_2026.xlsx
// Editar aquí si cambia el template del Excel; no tocar el parser.

import type { Puesto, PreguntaKey } from '@/types'

// ─── Hojas a ignorar ──────────────────────────────────────────────────────────
export const IGNORE_SHEETS = ['PREMIACIÓN']

// ─── Celda con el nombre real del participante ────────────────────────────────
export const NAME_CELL = 'F2' // p.ej. 'Alejandro Quiroz'

// ─── Columnas por grupo (equipo, marcador) ────────────────────────────────────
// Verificado contra el Excel real (grupo F = W/X, omitido en el spec original)
export const GROUP_COLS: Record<string, { team: string; score: string }> = {
  A: { team: 'C', score: 'D' },
  B: { team: 'G', score: 'H' },
  C: { team: 'K', score: 'L' },
  D: { team: 'O', score: 'P' },
  E: { team: 'S', score: 'T' },
  F: { team: 'W', score: 'X' },
  G: { team: 'AA', score: 'AB' },
  H: { team: 'AE', score: 'AF' },
  I: { team: 'AI', score: 'AJ' },
  J: { team: 'AM', score: 'AN' },
  K: { team: 'AQ', score: 'AR' },
  L: { team: 'AU', score: 'AV' },
}

export const GROUPS = Object.keys(GROUP_COLS) // ['A', 'B', ..., 'L']

// ─── Pares de filas por partido dentro de cada grupo ─────────────────────────
// 6 partidos × 2 filas (local, visitante)
export const MATCH_ROW_PAIRS: [number, number][] = [
  [11, 12],
  [14, 15],
  [17, 18],
  [20, 21],
  [23, 24],
  [26, 27],
]

// ─── Clasificados a dieciseisavos (filas por posición) ───────────────────────
export const QUALIFY_ROWS: Record<number, number> = {
  1: 42, // 1er clasificado del grupo
  2: 43, // 2do clasificado del grupo
  3: 44, // 3er clasificado (mejores terceros)
}

// ─── Semis / puestos finales (celda completa, columna L) ─────────────────────
export const SEMIS_CELLS: Record<Puesto, string> = {
  campeon:     'L58',
  subcampeon:  'L59',
  '3':         'L60',
  '4':         'L61',
}

// ─── Preguntas (celdas de respuesta, columna C) ──────────────────────────────
export const QUESTION_CELLS: Record<PreguntaKey, string> = {
  p1: 'C74', // ¿Quién marcará el primer gol del Mundial?
  p2: 'C78', // ¿Quién será el goleador del Mundial?
  p3: 'C82', // ¿Cuántos goles marcará el goleador del torneo?
  p4: 'C86', // ¿Quién será el máximo asistidor del Mundial?
  p5: 'C90', // ¿Cuál será el equipo con más goles en el torneo?
  p6: 'C94', // ¿Cuántos goles se marcarán en la Final?
}

// ─── Hoja PREMIACIÓN ─────────────────────────────────────────────────────────
export const PRIZE_CELLS = {
  primero:  'D2', // 0.6
  segundo:  'D3', // 0.3
  grupos:   'D4', // 0.1
}

// ─── Diccionario de normalización de nombres de equipo ───────────────────────
// Clave: variante sucia (lowercase, sin espacios extra)
// Valor: nombre canónico
const TEAM_ALIASES_RAW: Record<string, string> = {
  'rep checa':       'Rep. Checa',
  'rep. checa':      'Rep. Checa',
  'república checa': 'Rep. Checa',
  'egypto':          'Egipto',
  'egipto':          'Egipto',
  'cuaracao':        'Curacao',
  'curaçao':         'Curacao',
  'curacao':         'Curacao',
  'corea del sur':   'Corea del Sur',
  'corea':           'Corea del Sur',
  'korea':           'Corea del Sur',
  'estados unidos':  'USA',
  'ee.uu.':          'USA',
  'ee. uu.':         'USA',
  'eeuu':            'USA',
  'usa':             'USA',
  'holanda':         'Países Bajos',
  'países bajos':    'Países Bajos',
  'paises bajos':    'Países Bajos',
  'netherlands':     'Países Bajos',
  'irán':            'Irán',
  'iran':            'Irán',
  'nueva zelanda':   'Nueva Zelanda',
  'new zealand':     'Nueva Zelanda',
  'arabia saudita':  'Arabia Saudita',
  'arabia saudí':    'Arabia Saudita',
  'côte d\'ivoire':  'Costa de Marfil',
  'costa de marfil': 'Costa de Marfil',
  'ivory coast':     'Costa de Marfil',
  'república dominicana': 'Rep. Dominicana',
  'rep. dominicana': 'Rep. Dominicana',
  'rep dominicana':  'Rep. Dominicana',
}

/**
 * Normaliza el nombre de un equipo: trim + lookup en TEAM_ALIASES.
 * Si no hay alias, devuelve el nombre con trim y capitalización original.
 */
export function normalizeTeam(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  const key = trimmed.toLowerCase()
  return TEAM_ALIASES_RAW[key] ?? trimmed
}
