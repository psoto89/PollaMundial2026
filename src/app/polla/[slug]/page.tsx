/**
 * GET /polla/[slug] — link de invitación / entrada a la polla.
 *
 * Flujo auto-join (modelo mínimo, una sola membresía por usuario):
 *   - Sin sesión → login con ?next de vuelta a este link.
 *   - Con sesión → se asegura la membresía (se crea sola si no existe) y entra al cuadro.
 * El `slug` identifica la polla a futuro; hoy hay una sola, así que solo gatilla el join.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureMembership } from '@/lib/membership'

export const revalidate = 0

export default async function JoinPollaPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/polla/${slug}`)}`)
  }

  // Crear la membresía si no existe (idempotente). Si falla, el dashboard muestra
  // el fallback "falta vincular".
  try {
    await ensureMembership(user.id, user.email ?? undefined)
  } catch (e) {
    console.error('[GET /polla/[slug]] auto-join falló', e)
  }

  redirect('/mis-pronosticos')
}
