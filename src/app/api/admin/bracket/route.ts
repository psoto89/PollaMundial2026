/**
 * POST  /api/admin/bracket  → crea un partido de eliminación (equipos + kickoff + slot)
 * PATCH /api/admin/bracket  → actualiza las rondas habilitadas (app_config.open_rounds)
 *
 * El sync de TheSportsDB le pega external_id + marcadores cuando se publiquen.
 * El partido queda abierto para pronóstico hasta kickoff - deadline (RLS lo fuerza),
 * y SOLO si su fase está en open_rounds.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRACKET_2026, ROUND_ORDER } from '@/config/bracket2026'

const FASES = ['dieciseisavos', 'octavos', 'cuartos', 'semis', 'tercer_puesto', 'final'] as const

const createSchema = z
  .object({
    fase: z.enum(FASES),
    equipoLocalId: z.string().uuid(),
    equipoVisitanteId: z.string().uuid(),
    kickoffAt: z.string().min(1), // ISO datetime
    bracketSlot: z.string().min(1).optional(),
  })
  .refine((d) => d.equipoLocalId !== d.equipoVisitanteId, {
    message: 'Los equipos deben ser distintos',
  })
  .refine((d) => !d.bracketSlot || BRACKET_2026.some((s) => s.slot === d.bracketSlot && s.round === d.fase), {
    message: 'El slot no existe o no corresponde a la fase',
  })

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const parsed = createSchema.safeParse(await req.json())
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
        bracket_slot: parsed.data.bracketSlot ?? null,
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

const patchSchema = z.object({
  openRounds: z.array(z.enum(ROUND_ORDER)),
})

export async function PATCH(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const db = createAdminClient()

    const { error } = await db
      .from('app_config')
      .update({ open_rounds: parsed.data.openRounds })
      .eq('id', 1)

    if (error) {
      return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, openRounds: parsed.data.openRounds })
  } catch (error) {
    console.error('[PATCH /api/admin/bracket]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
