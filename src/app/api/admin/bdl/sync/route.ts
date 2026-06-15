/**
 * POST /api/admin/bdl/sync
 *
 * Sincroniza partidos de BallDontLie FIFA World Cup API con nuestra BD.
 * Dos fases:
 *   1. POST { preview: true }  → fetch desde BDL, devuelve preview del mapeo (no escribe nada)
 *   2. POST { confirm: true }  → aplica el mapeo: external_id + marcadores actuales
 *
 * Usa fetchBdlMatches y mapStatus de lib/bdlPoller.ts (lógica compartida).
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTeam } from '@/config/excelMap'
import { fetchBdlMatches, mapStatus, type BdlMatch } from '@/lib/bdlPoller'

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

    // 1. Fetch todos los partidos 2026 desde BDL
    const bdlMatches = await fetchBdlMatches(apiKey, 'all')

    if (bdlMatches.length === 0) {
      return NextResponse.json({ error: 'BDL no devolvió partidos para 2026' }, { status: 404 })
    }

    console.log('[bdl/sync] Primer partido BDL (raw):', JSON.stringify(bdlMatches[0], null, 2))

    // 2. Cargar nuestros partidos con sus equipos
    const db = createAdminClient()
    const { data: ourMatchesRaw, error: dbError } = await db
      .from('matches')
      .select(`
        id, external_id, goles_local, goles_visitante, estado, last_source,
        equipo_local:teams!equipo_local_id(id, nombre),
        equipo_visitante:teams!equipo_visitante_id(id, nombre)
      `)

    if (dbError) throw new Error(`DB error: ${dbError.message}`)
    if (!ourMatchesRaw || ourMatchesRaw.length === 0) {
      return NextResponse.json(
        { error: 'No hay partidos en la BD. Importa el Excel primero desde /admin/import.' },
        { status: 400 },
      )
    }

    // 3. Mapa nombre normalizado → nuestro match
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
    for (const m of ourMatchesRaw as unknown as OurMatch[]) {
      if (!m.equipo_local || !m.equipo_visitante) continue
      const key = matchKey(
        normalizeTeam(m.equipo_local.nombre),
        normalizeTeam(m.equipo_visitante.nombre),
      )
      ourMatchMap.set(key, m)
    }

    // 4. Construir el mapeo BDL → nuestro match
    const mapped:   SyncResult[] = []
    const unmapped: BdlMatch[]   = []

    for (const bdl of bdlMatches) {
      if (!bdl.home_team || !bdl.away_team) {
        unmapped.push(bdl)
        continue
      }

      const bdlHomeNorm = normalizeTeam(bdl.home_team.name)
      const bdlAwayNorm = normalizeTeam(bdl.away_team.name)

      let ourMatch  = ourMatchMap.get(matchKey(bdlHomeNorm, bdlAwayNorm))
      const isReversed = !ourMatch
      if (!ourMatch) ourMatch = ourMatchMap.get(matchKey(bdlAwayNorm, bdlHomeNorm))

      if (!ourMatch) {
        unmapped.push(bdl)
        continue
      }

      const bdlEstado   = mapStatus(bdl.status)
      const localScore  = isReversed ? bdl.away_score : bdl.home_score
      const visitScore  = isReversed ? bdl.home_score : bdl.away_score

      mapped.push({
        bdlId:          bdl.id,
        bdlStatus:      bdl.status,
        bdlHome:        bdl.home_team.name,
        bdlAway:        bdl.away_team.name,
        bdlHomeScore:   localScore,
        bdlAwayScore:   visitScore,
        ourMatchId:     ourMatch.id,
        ourExternalId:  ourMatch.external_id,
        ourHome:        isReversed ? (ourMatch.equipo_visitante?.nombre ?? '') : (ourMatch.equipo_local?.nombre ?? ''),
        ourAway:        isReversed ? (ourMatch.equipo_local?.nombre ?? '')    : (ourMatch.equipo_visitante?.nombre ?? ''),
        ourEstado:      ourMatch.estado,
        bdlEstado,
        willUpdateId:      ourMatch.external_id !== String(bdl.id),
        willUpdateScore:   localScore !== null && (localScore !== ourMatch.goles_local || visitScore !== ourMatch.goles_visitante),
        willUpdateEstado:  ourMatch.estado !== bdlEstado,
        isReversed,
      })
    }

    // 5. Preview
    if (body.preview && !body.confirm) {
      const willUpdate = mapped.filter((m) => m.willUpdateId || m.willUpdateScore || m.willUpdateEstado)
      return NextResponse.json({
        ok:            true,
        preview:       true,
        total_bdl:     bdlMatches.length,
        mapped:        mapped.length,
        unmapped:      unmapped.length,
        mappedItems:   willUpdate,
        unmappedItems: unmapped.map((m) => ({
          bdlId:   m.id,
          bdlHome: m.home_team?.name ?? 'TBD',
          bdlAway: m.away_team?.name ?? 'TBD',
          group:   m.group,
        })),
      })
    }

    // 6. Confirmar: aplicar
    if (!body.confirm) {
      return NextResponse.json({ error: 'Enviar { preview: true } o { confirm: true }' }, { status: 400 })
    }

    let updatedCount = 0
    const errors: string[] = []

    for (const item of mapped) {
      const updateData: Record<string, unknown> = {
        external_id:    String(item.bdlId),
        last_source:    'webhook',
        last_source_at: new Date().toISOString(),
        estado:         item.bdlEstado,
      }
      if (item.bdlHomeScore !== null) updateData['goles_local']     = item.bdlHomeScore
      if (item.bdlAwayScore !== null) updateData['goles_visitante'] = item.bdlAwayScore

      const { error } = await db.from('matches').update(updateData).eq('id', item.ourMatchId)
      if (error) errors.push(`${item.ourMatchId}: ${error.message}`)
      else updatedCount++
    }

    return NextResponse.json({
      ok:            true,
      confirm:       true,
      updated:       updatedCount,
      unmapped:      unmapped.length,
      errors:        errors.length > 0 ? errors : undefined,
      unmappedTeams: unmapped.filter((m) => m.home_team && m.away_team).map((m) => ({
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

function matchKey(a: string, b: string) { return `${a}__vs__${b}` }

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
