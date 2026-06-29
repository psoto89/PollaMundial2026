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
  // Opcional: vincular una cuenta self-signup ya existente (Supabase Auth)
  authUserId: z.string().uuid().optional(),
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

    // Vinculación manual de un self-signup: usa el authUserId entrante.
    // Pre-asignación clásica: conserva el auth_user_id que ya tuviera el participante.
    let authUserId = parsed.data.authUserId ?? null
    if (!authUserId) {
      const { data: existingUser } = await db
        .from('participant_accounts')
        .select('auth_user_id')
        .eq('participant_id', parsed.data.participantId)
        .maybeSingle()
      authUserId = existingUser?.auth_user_id ?? null
    }

    const { error } = await db
      .from('participant_accounts')
      .upsert(
        {
          participant_id: parsed.data.participantId,
          email,
          auth_user_id: authUserId,
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

/**
 * DELETE /api/admin/cuentas
 * Borra por completo un participante (cuenta + picks + score + usuario de Auth).
 * Body: { email } o { participantId }. Útil para limpiar cuentas de prueba.
 */
const delSchema = z.object({
  email: z.string().email().optional(),
  participantId: z.string().uuid().optional(),
}).refine((d) => d.email || d.participantId, { message: 'email o participantId requerido' })

export async function DELETE(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const parsed = delSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const db = createAdminClient()

    // Resolver participant_id + auth_user_id desde la cuenta
    const q = db.from('participant_accounts').select('participant_id, auth_user_id, email')
    const { data: acc } = parsed.data.participantId
      ? await q.eq('participant_id', parsed.data.participantId).maybeSingle()
      : await q.ilike('email', parsed.data.email!).maybeSingle()

    const participantId = acc?.participant_id ?? parsed.data.participantId
    if (!participantId) {
      return NextResponse.json({ error: 'No se encontró la cuenta' }, { status: 404 })
    }

    // Borrar dependencias y el participante (FK on delete cascade cubre el resto)
    await db.from('scores_cache').delete().eq('participant_id', participantId)
    await db.from('predictions_bracket').delete().eq('participant_id', participantId)
    await db.from('participants').delete().eq('id', participantId)

    // Borrar el usuario de Supabase Auth para que no se re-cree por auto-join
    if (acc?.auth_user_id) {
      try { await db.auth.admin.deleteUser(acc.auth_user_id) } catch (e) { console.error('[DELETE cuentas] auth', e) }
    }

    return NextResponse.json({ ok: true, deleted: participantId, email: acc?.email ?? null })
  } catch (error) {
    console.error('[DELETE /api/admin/cuentas]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
