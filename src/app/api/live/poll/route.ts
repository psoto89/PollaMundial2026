/**
 * POST /api/live/poll
 * Pull público (sin auth) llamado por LiveView/Leaderboard cada 30-60s para
 * actualizar marcadores desde TheSportsDB livescore.
 *
 * Para evitar abuso (es público), solo le pega a la API externa si realmente
 * hay ≥1 partido en estado `live` en la BD. Sin partidos vivos → no-op barato.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncLive } from '@/lib/tsdbPoller'

export async function POST() {
  if (!process.env.THESPORTSDB_API_KEY) {
    return NextResponse.json({ ok: false, reason: 'no_api_key' })
  }

  try {
    // Gate: no llamar a TheSportsDB si no hay partidos en vivo.
    const db = createAdminClient()
    const { count } = await db
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'live')

    if (!count) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_live_match' })
    }

    const result = await syncLive()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
