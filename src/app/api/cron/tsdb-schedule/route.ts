/**
 * GET /api/cron/tsdb-schedule
 * Cron job diario: sincroniza el schedule completo desde TheSportsDB.
 * Vercel Cron: "0 6,14,22 * * *" (6am, 2pm, 10pm UTC).
 * Protegido con Authorization: Bearer {CRON_SECRET}.
 */
import { NextRequest, NextResponse } from 'next/server'
import { syncSchedule } from '@/lib/tsdbPoller'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncSchedule()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/tsdb-schedule]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
