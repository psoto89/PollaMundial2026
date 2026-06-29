// Tipos globales del proyecto Gran Polla Mundial 2026

export type Fase = 'grupos' | 'dieciseisavos' | 'octavos' | 'cuartos' | 'semis' | 'tercer_puesto' | 'final'
export type EstadoPartido = 'scheduled' | 'live' | 'finished'
export type Puesto = 'campeon' | 'subcampeon' | '3' | '4'
export type PreguntaKey = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6'
export type ScopeResultado = 'qualify' | 'semis' | 'question'

// ─── Entidades de base de datos ───────────────────────────────────────────────

export interface Participant {
  id: string
  sheet_alias: string
  nombre: string
  avatar_url: string | null
  created_at: string
}

export interface Team {
  id: string
  nombre: string
  grupo: string // A–L
  bandera: string | null
}

export interface Match {
  id: string
  fase: Fase
  grupo: string | null
  equipo_local_id: string
  equipo_visitante_id: string
  match_index: number // 0–71 para grupos
  goles_local: number | null
  goles_visitante: number | null
  estado: EstadoPartido
  minuto: number | null
  kickoff_at: string | null
  external_id: string | null
  bracket_slot: string | null // posición en la plantilla de eliminación (ver config/bracket2026.ts)
  advancer_team_id: string | null // equipo que clasificó (90' + ET/penales) — oficial
  // joins
  equipo_local?: Team
  equipo_visitante?: Team
}

// Pick del cuadro eliminatorio (Polla 2): a quién avanza + marcador 90' por slot.
export interface PredictionBracket {
  id: string
  participant_id: string
  slot: string // 'R32-01'..'F','3P' (config/bracket2026.ts)
  advancer_team_id: string | null
  pred_local: number | null
  pred_visitante: number | null
  updated_at: string
}

export interface PredictionGroup {
  id: string
  participant_id: string
  match_id: string
  pred_local: number
  pred_visitante: number
}

export interface PredictionQualify {
  id: string
  participant_id: string
  grupo: string
  posicion: 1 | 2 | 3
  team_id: string
}

export interface PredictionSemis {
  id: string
  participant_id: string
  puesto: Puesto
  team_id: string
}

export interface PredictionQuestion {
  id: string
  participant_id: string
  pregunta_key: PreguntaKey
  respuesta: string
}

export interface OfficialResult {
  id: string
  scope: ScopeResultado
  key: string
  value: Record<string, unknown>
}

export interface ScoresCache {
  participant_id: string
  total: number
  total_grupos: number
  total_eliminacion: number
  // Subtotales por ronda de eliminación (suma = total_eliminacion)
  total_r32: number
  total_r16: number
  total_qf: number
  total_sf: number
  total_final: number
  // Bonos de cuadro (Polla 2 reconvertida). total_eliminacion = Σ(rondas) + Σ(bonos).
  total_bono_octavos: number  // 1 × clasificados a 8vos (máx 16)
  total_bono_cuartos: number  // 2 × clasificados a cuartos (máx 16)
  total_bono_semis: number    // 5 × semifinalistas (máx 20)
  total_bono_finales: number  // campeón 25 + subcampeón 15 + tercero 10
  total_clasificados: number
  total_semis: number
  total_preguntas: number
  updated_at: string
}

export interface PrizePool {
  id: string
  pct_primero: number
  pct_segundo: number
  pct_grupos: number
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface DesglosePuntos {
  signo: number         // 0 o 2
  exacto: number        // 0 o 3
  total: number
}

export interface DesgloseClasificados {
  clasificado: number   // 0 o 4 por cada equipo acertado
  posicion: number      // 0 o 4 adicionales por posición exacta
  total: number
}

export interface DesgloseSemis {
  semifinalista: number // 0 o 10 por cada pick que llegó a semis
  puestoExacto: number  // 0 o 20/15/12/10 por puesto exacto
  total: number
}

export interface DesglosePreguntas {
  acertadas: number     // 0–6
  total: number         // acertadas × 7
}

// Polla 2 (bracket): puntos por partido de eliminación.
export interface DesgloseKnockout {
  marcador: number      // 5 (exacto) | 2 (signo 90') | 0
  clasificado: number   // 2 si el equipo que avanza coincide, si no 0
  total: number
}

// Polla 2 (bracket): bonos de cuadro.
export interface DesgloseBonos {
  octavos: number       // 1 × aciertos (máx 16)
  cuartos: number       // 2 × aciertos (máx 16)
  semis: number         // 5 × aciertos (máx 20)
  campeon: number       // 0 | 25
  subcampeon: number    // 0 | 15
  tercero: number       // 0 | 10
  total: number
}

export interface Totales {
  grupos: number
  clasificados: number
  semis: number
  preguntas: number
  total: number
}

// ─── Live provider ────────────────────────────────────────────────────────────

export interface LiveMatch {
  id: string
  goles_local: number
  goles_visitante: number
  minuto: number
  estado: EstadoPartido
}

// ─── Parser de Excel ─────────────────────────────────────────────────────────

export interface ParsedPredictionGroup {
  matchIndex: number // 0–71
  grupo: string
  localTeam: string
  visitanteTeam: string
  predLocal: number | null
  predVisitante: number | null
}

export interface ParsedPredictionQualify {
  grupo: string
  posicion: 1 | 2 | 3
  team: string
}

export interface ParsedPredictionSemis {
  puesto: Puesto
  team: string
}

export interface ParsedPredictionQuestion {
  key: PreguntaKey
  respuesta: string | number | null
}

export interface ParsedParticipant {
  sheetAlias: string
  nombre: string
  predictionsGroup: ParsedPredictionGroup[]
  predictionsQualify: ParsedPredictionQualify[]
  predictionsSemis: ParsedPredictionSemis[]
  predictionsQuestions: ParsedPredictionQuestion[]
}

export interface ParsedTeam {
  nombre: string
  grupo: string
}

export interface ParsedMatch {
  matchIndex: number
  grupo: string
  localTeam: string
  visitanteTeam: string
}

export interface ParsedExcel {
  participants: ParsedParticipant[]
  teams: ParsedTeam[]
  matches: ParsedMatch[]
  prizePool: {
    pctPrimero: number
    pctSegundo: number
    pctGrupos: number
  }
}
