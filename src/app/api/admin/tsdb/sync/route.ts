/**
 * POST /api/admin/tsdb/sync
 * Sincronización manual del schedule (endpoint A de TheSportsDB).
 * Mapea external_id + importa marcadores de partidos FT.
 * Llamado desde el botón "Sincronizar partidos" en /admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { syncSchedule } from '@/lib/tsdbPoller'

export async function POST(req: NextRequest) {
  void req
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    if (!process.env.THESPORTSDB_API_KEY) {
      return NextResponse.json(
        { error: 'THESPORTSDB_API_KEY no configurado en variables de entorno' },
        { status: 500 },
      )
    }

    const result = await syncSchedule()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[POST /api/admin/tsdb/sync]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
