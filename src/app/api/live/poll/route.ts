/**
 * POST /api/live/poll
 *
 * Pull público (sin auth) que actualiza los partidos en vivo desde BDL.
 * Llamado por el LiveView cada 45 segundos cuando hay partidos live.
 *
 * Rate-limiting implícito: Vercel Edge Cache limita a 1 call por instancia.
 * No requiere auth — es una lectura de datos públicos de fútbol.
 */
import { NextResponse } from 'next/server'
import { syncBdlToSupabase } from '@/lib/bdlPoller'

export async function POST() {
  if (!process.env.BALLDONTLIE_API_KEY) {
    return NextResponse.json({ ok: false, reason: 'no_api_key' })
  }

  try {
    const result = await syncBdlToSupabase('live')
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
