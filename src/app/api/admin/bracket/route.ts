/**
 * POST /api/admin/bracket
 * Crea un partido de eliminación con equipos ya conocidos + kickoff.
 * El sync de TheSportsDB le pega external_id + marcadores cuando se publiquen.
 * El partido queda abierto para pronóstico hasta kickoff - deadline (RLS lo fuerza).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const schema = z.object({
  fase: z.enum(['dieciseisavos', 'octavos', 'cuartos', 'semis', 'tercer_puesto', 'final']),
  equipoLocalId: z.string().uuid(),
  equipoVisitanteId: z.string().uuid(),
  kickoffAt: z.string().min(1), // ISO datetime
}).refine((d) => d.equipoLocalId !== d.equipoVisitanteId, {
  message: 'Los equipos deben ser distintos',
})

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const db = createAdminClient()

    // match_index secuencial: siguiente después del máximo actual
    const { data: maxRow } = await db
      .from('matches')
      .select('match_index')
      .order('match_index', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextIndex = (maxRow?.match_index ?? -1) + 1

    const { data, error } = await db
      .from('matches')
      .insert({
        fase: parsed.data.fase,
        grupo: null,
        equipo_local_id: parsed.data.equipoLocalId,
        equipo_visitante_id: parsed.data.equipoVisitanteId,
        match_index: nextIndex,
        kickoff_at: parsed.data.kickoffAt,
        estado: 'scheduled',
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: `No se pudo crear: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: data.id, matchIndex: nextIndex })
  } catch (error) {
    console.error('[POST /api/admin/bracket]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
