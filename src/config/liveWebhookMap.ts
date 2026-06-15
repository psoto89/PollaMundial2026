/**
 * config/liveWebhookMap.ts
 *
 * Mapeo entre el payload de BallDontLie y nuestro modelo interno.
 *
 * ─── Lo que está CONFIRMADO (del spec oficial de BallDontLie) ────────────────
 *
 * HEADERS en cada POST:
 *   X-BDL-Webhook-Signature  → "v1=<hex_digest>" (HMAC-SHA256)
 *   X-BDL-Webhook-Timestamp  → Unix timestamp como string
 *   X-BDL-Webhook-Id         → UUID único del evento (para deduplicación)
 *
 * VERIFICACIÓN DE FIRMA:
 *   message  = `${timestamp}.${rawBody}`
 *   expected = "v1=" + HMAC-SHA256(message, BALLDONTLIE_WEBHOOK_SECRET).hex()
 *   Comparar con timingSafeEqual
 *
 * ENVELOPE (campos de primer nivel, confirmados por OpenAPI spec):
 *   {
 *     id:         string (UUID del evento)
 *     type:       string ("worldcup.game.started" | "worldcup.team.goal" | ...)
 *     sport:      "worldcup"
 *     game_id:    number (entero — el ID en su sistema, guardamos en matches.external_id)
 *     payload:    object (¡shape exacto NO documentado en su spec — ver nota abajo!)
 *     created_at: string (ISO datetime)
 *   }
 *
 * TIPOS DE EVENTO disponibles para World Cup:
 *   worldcup.game.started            → partido comienza
 *   worldcup.game.halftime           → medio tiempo
 *   worldcup.game.second_half_started → segundo tiempo
 *   worldcup.game.extra_time         → tiempo extra
 *   worldcup.game.penalty_shootout   → penales
 *   worldcup.game.ended              → partido termina
 *   worldcup.player.goal             → gol de jugador
 *   worldcup.player.assist           → asistencia
 *   worldcup.team.goal               → gol del equipo (más confiable para marcador)
 *   worldcup.var.decision            → decisión VAR
 *   worldcup.penalty_shootout.kick   → tiro penal en shootout
 *
 * ─── Lo que está INFERIDO (campo `payload` — spec solo dice "object") ────────
 *
 * El spec NO documenta el shape exacto del campo `payload` para eventos de World Cup.
 * Los extractores abajo usan múltiples fallbacks para ser resilientes a distintos shapes.
 *
 * IMPORTANTE: al llegar el primer evento real, Vercel Logs mostrará el raw payload.
 * Actualiza VERIFIED_PAYLOAD_SHAPE cuando lo veas, y ajusta los extractores si hacen falta.
 *
 * Shape probable (basado en NBA API del mismo proveedor + patrones comunes de soccer APIs):
 *   payload.game?.home_score   o   payload.home_score   → goles local
 *   payload.game?.away_score   o   payload.away_score   → goles visitante
 *   payload.game?.minute       o   payload.minute       → minuto de juego
 *   payload.game?.status       o   payload.status       → estado del partido
 */

// ─── Confirmado: tipos de evento → estado interno ─────────────────────────────

/** Tipos de evento de BallDontLie que disparan actualización de estado en BD. */
export const GAME_EVENT_TYPES = new Set([
  'worldcup.game.started',
  'worldcup.game.halftime',
  'worldcup.game.second_half_started',
  'worldcup.game.extra_time',
  'worldcup.game.penalty_shootout',
  'worldcup.game.ended',
  'worldcup.player.goal',
  'worldcup.team.goal',
  'worldcup.penalty_shootout.kick',
])

/** Mapa de tipo de evento → estado interno ('live' | 'finished' | null si no cambia). */
export const EVENT_TO_ESTADO: Record<string, 'live' | 'finished' | null> = {
  'worldcup.game.started':             'live',
  'worldcup.game.halftime':            'live',
  'worldcup.game.second_half_started': 'live',
  'worldcup.game.extra_time':          'live',
  'worldcup.game.penalty_shootout':    'live',
  'worldcup.game.ended':               'finished',
  'worldcup.player.goal':              'live',
  'worldcup.team.goal':                'live',
  'worldcup.player.assist':            null,   // no cambia estado/marcador
  'worldcup.var.decision':             null,   // puede cambiar marcador si revierte gol
  'worldcup.penalty_shootout.kick':    'live',
}

// ─── Interfaz del envelope confirmado ─────────────────────────────────────────

export interface BdlWebhookEnvelope {
  id:         string
  type:       string
  sport:      string
  game_id:    number
  payload:    Record<string, unknown>
  created_at: string
}

// ─── Interfaz de lo que extraemos del payload ─────────────────────────────────

export interface ExtractedMatchState {
  /** Goles del equipo local. null si no se puede extraer. */
  golesLocal:     number | null
  /** Goles del equipo visitante. null si no se puede extraer. */
  golesVisitante: number | null
  /** Minuto del partido. null si no se puede extraer. */
  minuto:         number | null
  /** Estado interno. Derivado del tipo de evento. */
  estado:         'live' | 'finished' | null
}

/**
 * Extrae el estado del partido desde el payload del webhook.
 *
 * IMPORTANTE: el shape exacto del campo `payload` NO está documentado por BallDontLie.
 * Este extractor prueba múltiples paths en orden de probabilidad.
 *
 * Cuando veas el primer evento real en Vercel Logs:
 *   1. Copia el payload completo
 *   2. Verifica cuál path devuelve el score correcto
 *   3. Actualiza VERIFIED_PAYLOAD_SHAPE y simplifica el extractor
 */
export function extractMatchState(
  eventType: string,
  payload: Record<string, unknown>,
): ExtractedMatchState {
  const estado = EVENT_TO_ESTADO[eventType] ?? null

  // Helper: extraer número de forma segura desde distintos tipos
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // Helper: extraer valor de un path nested
  const get = (obj: unknown, ...keys: string[]): unknown => {
    let cur: unknown = obj
    for (const k of keys) {
      if (cur === null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[k]
    }
    return cur
  }

  // ── Intentar extraer goles ──────────────────────────────────────────────────
  // Path 1: payload.game.home_score / payload.game.away_score (estilo NBA)
  let golesLocal     = toNum(get(payload, 'game', 'home_score'))
  let golesVisitante = toNum(get(payload, 'game', 'away_score'))
  let minuto         = toNum(get(payload, 'game', 'minute'))

  // Path 2: payload.home_score / payload.away_score (directo)
  if (golesLocal === null)     golesLocal     = toNum(payload['home_score'])
  if (golesVisitante === null) golesVisitante = toNum(payload['away_score'])
  if (minuto === null)         minuto         = toNum(payload['minute'])

  // Path 3: payload.home_team_score / payload.visitor_team_score (NBA naming)
  if (golesLocal === null)     golesLocal     = toNum(payload['home_team_score'])
  if (golesVisitante === null) golesVisitante = toNum(payload['visitor_team_score'])

  // Path 4: payload.score.home / payload.score.away (otro patrón común)
  if (golesLocal === null)     golesLocal     = toNum(get(payload, 'score', 'home'))
  if (golesVisitante === null) golesVisitante = toNum(get(payload, 'score', 'away'))

  // Path 5: para eventos de gol tipo 'worldcup.team.goal', puede venir en:
  //   payload.total_home_score / payload.total_away_score
  if (golesLocal === null)     golesLocal     = toNum(payload['total_home_score'])
  if (golesVisitante === null) golesVisitante = toNum(payload['total_away_score'])

  // Path 6: payload.game_state.score (otro posible shape)
  if (golesLocal === null) {
    const gs = payload['game_state']
    if (gs && typeof gs === 'object') {
      const gsr = gs as Record<string, unknown>
      golesLocal     = toNum(gsr['home_score'] ?? gsr['home'])
      golesVisitante = toNum(gsr['away_score'] ?? gsr['away'])
      if (minuto === null) minuto = toNum(gsr['minute'] ?? gsr['time'])
    }
  }

  // ── Intentar extraer minuto si aún no tenemos ───────────────────────────────
  if (minuto === null) minuto = toNum(payload['time'])
  if (minuto === null) minuto = toNum(payload['elapsed'])

  return { golesLocal, golesVisitante, minuto, estado }
}

/**
 * VERIFIED_PAYLOAD_SHAPE
 *
 * Actualizar con el shape real cuando llegue el primer webhook real.
 * Ejemplo:
 *
 * {
 *   "game": {
 *     "id": 123,
 *     "home_score": 1,
 *     "away_score": 0,
 *     "minute": 67,
 *     "status": "live"
 *   }
 * }
 */
export const VERIFIED_PAYLOAD_SHAPE: string | null = null  // null = aún no verificado
