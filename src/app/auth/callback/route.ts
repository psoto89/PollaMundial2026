/**
 * GET /auth/callback
 * Recibe el magic link de Supabase, intercambia el code por sesión y redirige.
 * El trigger on_auth_user_created vincula auth_user_id ↔ participant por email.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/mis-pronosticos'

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  } else if (tokenHash && type) {
    // Flujo OTP por token_hash (fallback)
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'magiclink' | 'email',
      token_hash: tokenHash,
    })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
