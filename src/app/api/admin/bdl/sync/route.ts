/**
 * POST /api/admin/bdl/sync
 *
 * Sincroniza partidos de BallDontLie FIFA World Cup API con nuestra BD.
 * Dos fases:
 *   1. POST { preview: true }  → fetch desde BDL, devuelve preview del mapeo (no escribe nada)
 *   2. POST { confirm: true }  → aplica el mapeo: external_id + marcadores actuales
 *
 * Base URL: https://api.balldontlie.io/fifa/worldcup/v1/
 * Auth: Authorization: {BALLDONTLIE_API_KEY}
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTeam } from '@/config/excelMap'

// ─── Tipos de BDL ─────────────────────────────────────────────────────────────

interface BdlTeam {
  id:           number
  name:         string
  short_name?:  string
  abbreviation?: string
  [key: string]: unknown
}

interface BdlMatch {
  id:         number
  match_number?: number
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

interface BdlMatchesResponse {
  data:   BdlMatch[]
  meta?:  { next_cursor?: string | null; per_page?: number }
}

// ─── Mapeo de estado ──────────────────────────────────────────────────────────

// BDL usa statuses estilo soccer estándar.
// Log el valor real si falla — ajustar aquí cuando veamos el primer partido.
const BDL_STATUS_TO_ESTADO: Record<string, 'scheduled' | 'live' | 'finished'> = {
  // No iniciado
  ns: 'scheduled', NS: 'scheduled',
  // En vivo (primera mitad, descanso, segunda mitad, tiempo extra, penales)
  '1H': 'live', ht: 'live', HT: 'live',
  '2H': 'live', ET: 'live',
  BT: 'live',   // Break Time (entre primera y segunda mitad de ET)
  P:  'live', PEN: 'live', SUSP: 'live',
  // Terminado
  FT:  'finished', AET: 'finished',
  AP:  'finished', PEN_FT: 'finished',
  // PENALIDADES terminadas
  ARR: 'finished',
}

function bdlStatusToEstado(status: string): 'scheduled' | 'live' | 'finished' {
  return BDL_STATUS_TO_ESTADO[status] ?? 'scheduled'
}

// ─── Fetch desde BDL con paginación ──────────────────────────────────────────

async function fetchAllBdlMatches(apiKey: string): Promise<BdlMatch[]> {
  const all: BdlMatch[] = []
  let cursor: string | null = null
  let page = 0

  do {
    const url = new URL('https://api.balldontlie.io/fifa/worldcup/v1/matches')
    url.searchParams.set('seasons[]', '2026')
    url.searchParams.set('per_page', '100')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      // Sin caché en server-side para tener datos frescos
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`BDL API error ${res.status}: ${text.slice(0, 200)}`)
    }

    const body = await res.json() as BdlMatchesResponse
    all.push(...(body.data ?? []))
    cursor = body.meta?.next_cursor ?? null
    page++

    // Límite de seguridad: máx 10 páginas (1000 partidos)
    if (page >= 10) break
  } while (cursor)

  return all
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const apiKey = process.env.BALLDONTLIE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'BALLDONTLIE_API_KEY no configurado en variables de entorno' },
        { status: 500 },
      )
    }

    const body = await req.json() as { preview?: boolean; confirm?: boolean }

    // 1. Fetch partidos desde BDL
    const bdlMatches = await fetchAllBdlMatches(apiKey)

    if (bdlMatches.length === 0) {
      return NextResponse.json({ error: 'BDL no devolvió partidos para 2026' }, { status: 404 })
    }

    // Log raw primer partido para verificar field names (util en primeras ejecuciones)
    console.log('[bdl/sync] Primer partido BDL (raw):', JSON.stringify(bdlMatches[0], null, 2))

    // 2. Cargar nuestros partidos con sus equipos
    const db = createAdminClient()
    const { data: ourMatches, error: dbError } = await db
      .from('matches')
      .select(`
        id, external_id, goles_local, goles_visitante, estado, last_source,
        equipo_local:teams!equipo_local_id(id, nombre),
        equipo_visitante:teams!equipo_visitante_id(id, nombre)
      `)

    if (dbError) throw new Error(`DB error: ${dbError.message}`)
    if (!ourMatches || ourMatches.length === 0) {
      return NextResponse.json(
        { error: 'No hay partidos en la BD. Importa el Excel primero desde /admin/import.' },
        { status: 400 },
      )
    }

    // 3. Construir mapa de nombre normalizado → nuestro match
    type OurMatch = {
      id: string
      external_id: string | null
      goles_local: number | null
      goles_visitante: number | null
      estado: string
      last_source: string | null
      equipo_local: { id: string; nombre: string } | null
      equipo_visitante: { id: string; nombre: string } | null
    }

    const ourMatchMap = new Map<string, OurMatch>()
    for (const m of ourMatches as unknown as OurMatch[]) {
      if (!m.equipo_local || !m.equipo_visitante) continue
      const key = matchKey(
        normalizeTeam(m.equipo_local.nombre),
        normalizeTeam(m.equipo_visitante.nombre),
      )
      ourMatchMap.set(key, m)
    }

    // 4. Construir preview del mapeo
    const mapped:    SyncResult[] = []
    const unmapped:  BdlMatch[]   = []

    for (const bdl of bdlMatches) {
      // Solo fase de grupos e iniciales; saltar partidos sin equipos definidos (knockout TBD)
      if (!bdl.home_team || !bdl.away_team) {
        unmapped.push(bdl)
        continue
      }

      const bdlHomeNorm = normalizeTeam(bdl.home_team.name)
      const bdlAwayNorm = normalizeTeam(bdl.away_team.name)

      // Intentar match directo
      let ourMatch = ourMatchMap.get(matchKey(bdlHomeNorm, bdlAwayNorm))

      // Intentar match invertido (por si el orden local/visitante difiere)
      const isReversed = !ourMatch
      if (!ourMatch) {
        ourMatch = ourMatchMap.get(matchKey(bdlAwayNorm, bdlHomeNorm))
      }

      if (!ourMatch) {
        unmapped.push(bdl)
        continue
      }

      const bdlEstado = bdlStatusToEstado(bdl.status)

      mapped.push({
        bdlId:          bdl.id,
        bdlStatus:      bdl.status,
        bdlHome:        bdl.home_team.name,
        bdlAway:        bdl.away_team.name,
        bdlHomeScore:   isReversed ? bdl.away_score : bdl.home_score,
        bdlAwayScore:   isReversed ? bdl.home_score : bdl.away_score,
        ourMatchId:     ourMatch.id,
        ourExternalId:  ourMatch.external_id,
        ourHome:        isReversed ? ourMatch.equipo_visitante?.nombre ?? '' : ourMatch.equipo_local?.nombre ?? '',
        ourAway:        isReversed ? ourMatch.equipo_local?.nombre ?? ''    : ourMatch.equipo_visitante?.nombre ?? '',
        ourEstado:      ourMatch.estado,
        bdlEstado,
        willUpdateId:   ourMatch.external_id !== String(bdl.id),
        willUpdateScore: bdl.home_score !== null && (
          (isReversed ? bdl.away_score : bdl.home_score) !== ourMatch.goles_local ||
          (isReversed ? bdl.home_score : bdl.away_score) !== ourMatch.goles_visitante
        ),
        willUpdateEstado: ourMatch.estado !== bdlEstado,
        isReversed,
      })
    }

    // 5. Si es solo preview, retornar aquí
    if (body.preview && !body.confirm) {
      return NextResponse.json({
        ok: true,
        preview: true,
        total_bdl:    bdlMatches.length,
        mapped:       mapped.length,
        unmapped:     unmapped.length,
        mappedItems:  mapped,
        unmappedItems: unmapped.map((m) => ({
          bdlId:   m.id,
          bdlHome: m.home_team?.name ?? 'TBD',
          bdlAway: m.away_team?.name ?? 'TBD',
          status:  m.status,
          group:   m.group,
        })),
      })
    }

    // 6. Confirmar: aplicar el mapeo
    if (!body.confirm) {
      return NextResponse.json({ error: 'Enviar { preview: true } o { confirm: true }' }, { status: 400 })
    }

    let updatedCount    = 0
    let skippedManual  = 0
    const errors: string[] = []

    for (const item of mapped) {
      // No pisar updates manuales recientes (respetar el lock igual que el webhook)
      // Para el sync inicial forzamos — es una operación consciente del admin
      const updateData: Record<string, unknown> = {
        external_id:    String(item.bdlId),
        last_source:    'webhook',
        last_source_at: new Date().toISOString(),
      }

      if (item.bdlHomeScore !== null) updateData['goles_local']     = item.bdlHomeScore
      if (item.bdlAwayScore !== null) updateData['goles_visitante'] = item.bdlAwayScore
      if (item.bdlEstado)             updateData['estado']          = item.bdlEstado

      const { error } = await db
        .from('matches')
        .update(updateData)
        .eq('id', item.ourMatchId)

      if (error) {
        errors.push(`${item.ourMatchId}: ${error.message}`)
      } else {
        updatedCount++
      }
    }

    return NextResponse.json({
      ok: true,
      confirm: true,
      updated:      updatedCount,
      skipped:      skippedManual,
      unmapped:     unmapped.length,
      errors:       errors.length > 0 ? errors : undefined,
      unmappedTeams: unmapped.map((m) => ({
        bdlId:   m.id,
        bdlHome: m.home_team?.name ?? 'TBD',
        bdlAway: m.away_team?.name ?? 'TBD',
        group:   m.group,
      })),
    })
  } catch (error) {
    console.error('[POST /api/admin/bdl/sync]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchKey(homeNorm: string, awayNorm: string): string {
  return `${homeNorm}__vs__${awayNorm}`
}

interface SyncResult {
  bdlId:            number
  bdlStatus:        string
  bdlHome:          string
  bdlAway:          string
  bdlHomeScore:     number | null
  bdlAwayScore:     number | null
  ourMatchId:       string
  ourExternalId:    string | null
  ourHome:          string
  ourAway:          string
  ourEstado:        string
  bdlEstado:        'scheduled' | 'live' | 'finished'
  willUpdateId:     boolean
  willUpdateScore:  boolean
  willUpdateEstado: boolean
  isReversed:       boolean
}
