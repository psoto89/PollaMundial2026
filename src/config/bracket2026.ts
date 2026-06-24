// ============================================================
// Plantilla del bracket de eliminación — Mundial 2026 (48 equipos)
//
// Define la ESTRUCTURA fija de la fase final: 16avos (32 equipos) → 8vos →
// Cuartos → Semis → Final (+ Tercer puesto). La rama se dibuja en
// /mis-pronosticos a partir de esta plantilla aunque todavía no exista ningún
// partido real en la base; los partidos reales se superponen por `slot`.
//
// ⚠️ VERIFICAR ANTES DE PRODUCCIÓN:
//   - La estructura de AVANCE (ganadores que se cruzan en cada ronda) es
//     consistente como árbol binario, pero los `feeder` de 16avos (qué posición
//     de grupo juega contra cuál, y a qué 8vos avanza el ganador) deben calcarse
//     de la llave oficial publicada por FIFA para 2026. Editar los feeders de
//     R32 abajo si difieren del cuadro oficial.
// ============================================================

export type RoundKey =
  | 'dieciseisavos'
  | 'octavos'
  | 'cuartos'
  | 'semis'
  | 'tercer_puesto'
  | 'final'

export interface BracketSlot {
  slot: string // identificador estable, mapea a matches.bracket_slot
  round: RoundKey
  order: number // posición dentro de la ronda (para ordenar)
  localFeeder: string // '1A' | '3° (C/E/F/H)' | 'Ganador R32-01' ...
  visitanteFeeder: string
}

export const ROUND_ORDER: RoundKey[] = [
  'dieciseisavos',
  'octavos',
  'cuartos',
  'semis',
  'tercer_puesto',
  'final',
]

export const ROUND_LABELS: Record<RoundKey, string> = {
  dieciseisavos: '16avos',
  octavos: '8vos',
  cuartos: 'Cuartos',
  semis: 'Semis',
  tercer_puesto: 'Tercer puesto',
  final: 'Final',
}

// ─── 16avos (Round of 32): 16 partidos ────────────────────────
// 12 ganadores de grupo (1A..1L) + 12 segundos (2A..2L) + 8 mejores terceros.
// Pares aproximados al formato 2026 — verificar contra la llave oficial FIFA.
const DIECISEISAVOS: BracketSlot[] = [
  { slot: 'R32-01', round: 'dieciseisavos', order: 1, localFeeder: '1A', visitanteFeeder: '3° (C/E/F/H)' },
  { slot: 'R32-02', round: 'dieciseisavos', order: 2, localFeeder: '1E', visitanteFeeder: '3° (A/B/C/D)' },
  { slot: 'R32-03', round: 'dieciseisavos', order: 3, localFeeder: '1F', visitanteFeeder: '2C' },
  { slot: 'R32-04', round: 'dieciseisavos', order: 4, localFeeder: '1C', visitanteFeeder: '2F' },
  { slot: 'R32-05', round: 'dieciseisavos', order: 5, localFeeder: '1I', visitanteFeeder: '3° (C/D/F/G)' },
  { slot: 'R32-06', round: 'dieciseisavos', order: 6, localFeeder: '2A', visitanteFeeder: '2B' },
  { slot: 'R32-07', round: 'dieciseisavos', order: 7, localFeeder: '1B', visitanteFeeder: '3° (E/F/G/I)' },
  { slot: 'R32-08', round: 'dieciseisavos', order: 8, localFeeder: '1L', visitanteFeeder: '2I' },
  { slot: 'R32-09', round: 'dieciseisavos', order: 9, localFeeder: '1D', visitanteFeeder: '3° (B/E/F/I)' },
  { slot: 'R32-10', round: 'dieciseisavos', order: 10, localFeeder: '1G', visitanteFeeder: '3° (A/H/I/J)' },
  { slot: 'R32-11', round: 'dieciseisavos', order: 11, localFeeder: '1H', visitanteFeeder: '2J' },
  { slot: 'R32-12', round: 'dieciseisavos', order: 12, localFeeder: '1J', visitanteFeeder: '2H' },
  { slot: 'R32-13', round: 'dieciseisavos', order: 13, localFeeder: '1K', visitanteFeeder: '3° (D/E/I/J)' },
  { slot: 'R32-14', round: 'dieciseisavos', order: 14, localFeeder: '2D', visitanteFeeder: '2G' },
  { slot: 'R32-15', round: 'dieciseisavos', order: 15, localFeeder: '2E', visitanteFeeder: '2L' },
  { slot: 'R32-16', round: 'dieciseisavos', order: 16, localFeeder: '2K', visitanteFeeder: '3° (...)' },
]

// ─── Rondas de avance: feeders = ganadores de la ronda previa ──
// Árbol binario: cada partido toma los ganadores de dos partidos consecutivos.
const OCTAVOS: BracketSlot[] = Array.from({ length: 8 }, (_, i) => ({
  slot: `R16-${String(i + 1).padStart(2, '0')}`,
  round: 'octavos' as const,
  order: i + 1,
  localFeeder: `Ganador R32-${String(2 * i + 1).padStart(2, '0')}`,
  visitanteFeeder: `Ganador R32-${String(2 * i + 2).padStart(2, '0')}`,
}))

const CUARTOS: BracketSlot[] = Array.from({ length: 4 }, (_, i) => ({
  slot: `QF-${i + 1}`,
  round: 'cuartos' as const,
  order: i + 1,
  localFeeder: `Ganador R16-${String(2 * i + 1).padStart(2, '0')}`,
  visitanteFeeder: `Ganador R16-${String(2 * i + 2).padStart(2, '0')}`,
}))

const SEMIS: BracketSlot[] = [
  { slot: 'SF-1', round: 'semis', order: 1, localFeeder: 'Ganador QF-1', visitanteFeeder: 'Ganador QF-2' },
  { slot: 'SF-2', round: 'semis', order: 2, localFeeder: 'Ganador QF-3', visitanteFeeder: 'Ganador QF-4' },
]

const TERCER_PUESTO: BracketSlot[] = [
  { slot: '3P', round: 'tercer_puesto', order: 1, localFeeder: 'Perdedor SF-1', visitanteFeeder: 'Perdedor SF-2' },
]

const FINAL: BracketSlot[] = [
  { slot: 'F', round: 'final', order: 1, localFeeder: 'Ganador SF-1', visitanteFeeder: 'Ganador SF-2' },
]

export const BRACKET_2026: BracketSlot[] = [
  ...DIECISEISAVOS,
  ...OCTAVOS,
  ...CUARTOS,
  ...SEMIS,
  ...TERCER_PUESTO,
  ...FINAL,
]

// Slots agrupados por ronda, en el orden de ROUND_ORDER (para la UI).
export const BRACKET_BY_ROUND: { round: RoundKey; slots: BracketSlot[] }[] =
  ROUND_ORDER.map((round) => ({
    round,
    slots: BRACKET_2026.filter((s) => s.round === round).sort((a, b) => a.order - b.order),
  }))
