/**
 * Cliente admin con service role key — solo usar en API routes server-side.
 * Bypasea RLS; siempre validar la cookie admin ANTES de llamar esto.
 */
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
