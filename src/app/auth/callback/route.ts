/**
 * GET /auth/callback
 * Recibe el magic link de Supabase, intercambia el code (o token_hash) por sesión y
 * redirige. CRÍTICO: las cookies de sesión deben escribirse en la MISMA respuesta de
 * redirect que se retorna; si no, la sesión no persiste y el login entra en bucle.
 * El trigger on_auth_user_created vincula auth_user_id ↔ participant por email.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextParam = searchParams.get('next')
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/mis-pronosticos'

  // Respuesta de éxito: el cliente de Supabase escribirá las cookies de sesión en ELLA.
  const response = NextResponse.redirect(`${origin}${next}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return response
    console.error('[auth/callback] exchangeCodeForSession', error.message)
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'magiclink' | 'email',
      token_hash: tokenHash,
    })
    if (!error) return response
    console.error('[auth/callback] verifyOtp', error.message)
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
