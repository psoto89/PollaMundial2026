/**
 * lib/bdlPoller.ts
 *
 * Pull desde BallDontLie FIFA World Cup API y actualiza Supabase.
 * Usado en dos contextos:
 *   1. Desde /live/page.tsx (server component) — antes de renderizar
 *   2. Desde /api/admin/bdl/sync (sync masivo de external_id + marcadores)
 *
 * API: GET https://api.balldontlie.io/fifa/worldcup/v1/matches
 * Auth: Authorization: {BALLDONTLIE_API_KEY}
 * Requiere: BALLDONTLIE_API_KEY en env vars.
 */
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Tipos BDL ────────────────────────────────────────────────────────────────

export interface BdlTeam {
  id:            number
  name:          string
  short_name?:   string
  abbreviation?: string
}

export interface BdlMatch {
  id:         number
  datetime:   string | null
  status:     string
  stage:      string
  group:      string | null
  home_team:  BdlTeam | null
  away_team:  BdlTeam | null
  home_score: number | null
  away_score: number | null
  [key: string]: unknown
}

interface BdlResponse {
  data:  BdlMatch[]
  meta?: { next_cursor?: string | null }
}

// ─── Status mapping ───────────────────────────────────────────────────────────

// BDL usa IDs de estado estilo soccer estándar (Sportradar/Opta).
// Loguear el valor exacto si aparece "scheduled" inesperado — ajustar aquí.
const STATUS_MAP: Record<string, 'scheduled' | 'live' | 'finished'> = {
  // No iniciado
  ns: 'scheduled', NS: 'scheduled', TBD: 'scheduled',
  // En vivo
  '1H': 'live', HT: 'live', ht: 'live',
  '2H': 'live', ET: 'live', BT: 'live',
  P: 'live', PEN: 'live', SUSP: 'live', INT: 'live', LIVE: 'live',
  // Terminado
  FT: 'finished', AET: 'finished', PEN_FT: 'finished',
  AP: 'finished', ARR: 'finished', WO: 'finished', AWD: 'finished',
  // Cancelado/abandonado → tratar como scheduled para no esconder datos
  CANC: 'scheduled', POSTP: 'scheduled', ABD: 'scheduled',
}

export function mapStatus(bdlStatus: string): 'scheduled' | 'live' | 'finished' {
  return STATUS_MAP[bdlStatus] ?? 'scheduled'
}

// ─── Fetch partidos desde BDL ─────────────────────────────────────────────────

/**
 * Fetch de partidos de BDL con soporte de paginación.
 * @param filter 'live' | 'all' — si 'live', filtra solo partidos en curso
 */
export async function fetchBdlMatches(
  apiKey: string,
  filter: 'live' | 'all' = 'all',
): Promise<BdlMatch[]> {
  const all: BdlMatch[] = []
  let cursor: string | null = null
  let page = 0

  do {
    const url = new URL('https://api.balldontlie.io/fifa/worldcup/v1/matches')
    url.searchParams.set('seasons[]', '2026')
    url.searchParams.set('per_page', '100')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),  // 8s timeout
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`BDL API ${res.status}: ${text.slice(0, 200)}`)
    }

    const body = await res.json() as BdlResponse
    const matches = body.data ?? []

    if (filter === 'live') {
      // Solo los que están en vivo ahora mismo
      const live = matches.filter((m) => {
        const estado = mapStatus(m.status)
        return estado === 'live'
      })
      all.push(...live)
      // Si no hay live en esta página, parar — no necesitamos paginar más
      if (live.length === 0 && matches.length > 0) break
    } else {
      all.push(...matches)
    }

    cursor = body.meta?.next_cursor ?? null
    page++
    if (page >= 10) break  // límite de seguridad
  } while (cursor)

  return all
}

// ─── Actualizar Supabase con datos de BDL ────────────────────────────────────

export interface PollResult {
  updated:    number
  live:       number
  notMapped:  number
  errors:     string[]
}

/**
 * Sincroniza partidos desde BDL a Supabase.
 * Solo actualiza partidos que tienen `external_id` mapeado.
 * No pisa partidos con `last_source = 'manual'` recientes (lock de 10 min).
 *
 * @param filter 'live' — solo partidos en vivo (más rápido para polling frecuente)
 *               'all'  — todos los partidos (para sync inicial)
 */
export async function syncBdlToSupabase(
  filter: 'live' | 'all' = 'live',
): Promise<PollResult> {
  const apiKey = process.env.BALLDONTLIE_API_KEY
  if (!apiKey) {
    return { updated: 0, live: 0, notMapped: 0, errors: ['BALLDONTLIE_API_KEY no configurado'] }
  }

  const result: PollResult = { updated: 0, live: 0, notMapped: 0, errors: [] }

  try {
    const bdlMatches = await fetchBdlMatches(apiKey, filter)

    if (bdlMatches.length === 0) return result

    const db = createAdminClient()

    // Cargar nuestros partidos con external_id mapeado
    const { data: ourMatches } = await db
      .from('matches')
      .select('id, external_id, goles_local, goles_visitante, estado, last_source, last_source_at')
      .not('external_id', 'is', null)

    if (!ourMatches || ourMatches.length === 0) return result

    const ourMap = new Map(
      ourMatches.map((m: {
        id: string
        external_id: string | null
        goles_local: number | null
        goles_visitante: number | null
        estado: string
        last_source: string | null
        last_source_at: string | null
      }) => [m.external_id!, m]),
    )

    const MANUAL_LOCK_MS = 10 * 60 * 1000  // 10 minutos en ms

    for (const bdl of bdlMatches) {
      const bdlId = String(bdl.id)
      const ourMatch = ourMap.get(bdlId)

      if (!ourMatch) {
        result.notMapped++
        continue
      }

      const bdlEstado = mapStatus(bdl.status)
      if (bdlEstado === 'live') result.live++

      // Respetar lock manual
      if (ourMatch.last_source === 'manual' && ourMatch.last_source_at) {
        const elapsed = Date.now() - new Date(ourMatch.last_source_at).getTime()
        if (elapsed < MANUAL_LOCK_MS) continue
      }

      // Solo actualizar si hay cambio real
      const scoreChanged  = bdl.home_score !== ourMatch.goles_local || bdl.away_score !== ourMatch.goles_visitante
      const estadoChanged = bdlEstado !== ourMatch.estado
      if (!scoreChanged && !estadoChanged) continue

      const update: Record<string, unknown> = {
        last_source:    'poll',
        last_source_at: new Date().toISOString(),
      }
      if (bdl.home_score !== null) update['goles_local']     = bdl.home_score
      if (bdl.away_score !== null) update['goles_visitante'] = bdl.away_score
      update['estado'] = bdlEstado

      const { error } = await db.from('matches').update(update).eq('id', ourMatch.id)
      if (error) {
        result.errors.push(error.message)
      } else {
        result.updated++
      }
    }
  } catch (err) {
    result.errors.push(String(err))
  }

  return result
}
