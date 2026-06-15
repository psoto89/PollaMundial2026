/**
 * GET /api/cron/tsdb-live
 * Cron job cada 60s: actualiza marcadores en vivo desde TheSportsDB livescore.
 * Solo consulta la API si hay ≥1 partido live o kickoff dentro de ±2h.
 * Vercel Cron: "* * * * *" (cada minuto — requiere plan Pro).
 * Protegido con Authorization: Bearer {CRON_SECRET}.
 *
 * Nota: TheSportsDB livescore tiene ~2 min de delay sobre el marcador real.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncLive } from '@/lib/tsdbPoller'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Verificar si hay partido activo o dentro de la ventana ±2h
    const db = createAdminClient()
    const now = new Date()
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const windowEnd   = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()

    const { data: activeMatches } = await db
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`estado.eq.live,and(kickoff_at.gte.${windowStart},kickoff_at.lte.${windowEnd},estado.eq.scheduled)`)

    if (!activeMatches) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_active_window' })
    }

    const result = await syncLive()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/tsdb-live]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
