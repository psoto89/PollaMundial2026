/**
 * POST /api/admin/cuentas
 * Asigna (o actualiza) el email de un participante para que pueda entrar por magic link.
 * El trigger on_auth_user_created vincula auth_user_id cuando el participante entra.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const schema = z.object({
  participantId: z.string().uuid(),
  email: z.string().email().max(255),
})

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()
    const db = createAdminClient()

    // Si el participante ya entró antes con este email, re-vincular auth_user_id
    const { data: existingUser } = await db
      .from('participant_accounts')
      .select('auth_user_id')
      .eq('participant_id', parsed.data.participantId)
      .maybeSingle()

    const { error } = await db
      .from('participant_accounts')
      .upsert(
        {
          participant_id: parsed.data.participantId,
          email,
          // Conservar auth_user_id si ya existía
          auth_user_id: existingUser?.auth_user_id ?? null,
        },
        { onConflict: 'participant_id' },
      )

    if (error) {
      // Probable colisión de email único con otro participante
      return NextResponse.json({ error: `No se pudo guardar: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/admin/cuentas]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
