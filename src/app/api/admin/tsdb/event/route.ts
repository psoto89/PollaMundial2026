/**
 * GET /api/admin/tsdb/event
 * Debug admin: vuelca el JSON CRUDO de /lookup/event de TheSportsDB para descubrir
 * si trae el ganador/marcador de penales (y con qué nombre de campo).
 *
 * Uso (logueado como admin):
 *   - Sin parámetros → lista los partidos de eliminación FINALIZADOS con marcador
 *     empatado (candidatos a penales) con su id, external_id y equipos.
 *   - ?idEvent=123456 → JSON crudo del evento de TheSportsDB.
 *   - ?matchId=<uuid> → resuelve el external_id de ese partido y trae su evento.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const BASE_URL = 'https://www.thesportsdb.com/api/v2/json'

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    const apiKey = process.env.THESPORTSDB_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'THESPORTSDB_API_KEY no configurado' }, { status: 500 })
    }

    const db = createAdminClient()
    const url = new URL(req.url)
    let idEvent = url.searchParams.get('idEvent')
    const matchId = url.searchParams.get('matchId')

    // Resolver external_id a partir del matchId
    if (!idEvent && matchId) {
      const { data } = await db.from('matches').select('external_id').eq('id', matchId).single()
      idEvent = data?.external_id ?? null
      if (!idEvent) {
        return NextResponse.json({ error: 'El partido no tiene external_id' }, { status: 404 })
      }
    }

    // Sin parámetros: listar candidatos (eliminación finalizada con marcador empatado)
    if (!idEvent) {
      const { data } = await db
        .from('matches')
        .select(`
          id, external_id, bracket_slot, goles_local, goles_visitante, advancer_team_id,
          equipo_local:teams!equipo_local_id(nombre),
          equipo_visitante:teams!equipo_visitante_id(nombre)
        `)
        .neq('fase', 'grupos')
        .eq('estado', 'finished')
      type Row = {
        id: string; external_id: string | null; bracket_slot: string | null
        goles_local: number | null; goles_visitante: number | null; advancer_team_id: string | null
        equipo_local: { nombre: string } | null; equipo_visitante: { nombre: string } | null
      }
      const empatados = (data as unknown as Row[] ?? [])
        .filter((m) => m.goles_local !== null && m.goles_local === m.goles_visitante)
        .map((m) => ({
          matchId: m.id,
          idEvent: m.external_id,
          slot: m.bracket_slot,
          partido: `${m.equipo_local?.nombre} ${m.goles_local}-${m.goles_visitante} ${m.equipo_visitante?.nombre}`,
          clasificado: m.advancer_team_id ? 'definido' : 'SIN DEFINIR',
        }))
      return NextResponse.json({
        ayuda: 'Elige un idEvent o matchId de la lista y vuelve a llamar con ?idEvent=... o ?matchId=...',
        empatados,
      })
    }

    // Traer el evento crudo de TheSportsDB
    const res = await fetch(`${BASE_URL}/lookup/event/${idEvent}`, {
      headers: { 'X-API-KEY': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    const body = await res.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(body) } catch { /* devolver texto crudo si no es JSON */ }

    return NextResponse.json({
      idEvent,
      httpStatus: res.status,
      raw: parsed ?? body,
    })
  } catch (err) {
    console.error('[GET /api/admin/tsdb/event]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
