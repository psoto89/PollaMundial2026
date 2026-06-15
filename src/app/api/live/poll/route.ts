/**
 * POST /api/live/poll
 * Pull público (sin auth) llamado por LiveView cada 60s para actualizar
 * marcadores desde TheSportsDB livescore.
 * Solo activo cuando hay partidos live (el cliente lo comprueba antes de llamar).
 */
import { NextResponse } from 'next/server'
import { syncLive } from '@/lib/tsdbPoller'

export async function POST() {
  if (!process.env.THESPORTSDB_API_KEY) {
    return NextResponse.json({ ok: false, reason: 'no_api_key' })
  }

  try {
    const result = await syncLive()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
