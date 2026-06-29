/**
 * Auto-join self-service a la polla.
 * Asegura que un usuario de Supabase Auth tenga su fila en participant_accounts
 * (creando el participante si hace falta). Idempotente. Usa el service role, así
 * que SOLO llamar en contexto server tras validar que hay sesión.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export async function ensureMembership(authUserId: string, email: string | undefined): Promise<void> {
  const db = createAdminClient()

  // ¿Ya tiene cuenta vinculada?
  const { data: byAuth } = await db
    .from('participant_accounts')
    .select('participant_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (byAuth) return

  // ¿El admin pre-asignó este email pero el trigger no alcanzó a vincular?
  if (email) {
    const { data: byEmail } = await db
      .from('participant_accounts')
      .select('participant_id, auth_user_id')
      .ilike('email', email)
      .maybeSingle()
    if (byEmail) {
      if (!byEmail.auth_user_id) {
        await db
          .from('participant_accounts')
          .update({ auth_user_id: authUserId })
          .eq('participant_id', byEmail.participant_id)
      }
      return
    }
  }

  // Crear participante self-service + cuenta vinculada
  const nombre = email ? email.split('@')[0] : 'Participante'
  const { data: participant, error: pErr } = await db
    .from('participants')
    .insert({ sheet_alias: `auth:${authUserId}`, nombre })
    .select('id')
    .single()
  if (pErr || !participant) throw new Error(`No se pudo crear participante: ${pErr?.message}`)

  const { error: aErr } = await db
    .from('participant_accounts')
    .insert({
      participant_id: participant.id,
      email: email ?? `${authUserId}@noemail.local`,
      auth_user_id: authUserId,
    })
  if (aErr) throw new Error(`No se pudo crear cuenta: ${aErr.message}`)
}
