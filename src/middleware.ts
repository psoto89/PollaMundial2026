/**
 * Middleware de sesión de Supabase (@supabase/ssr).
 * Refresca el token en cada navegación y propaga las cookies de sesión a la
 * respuesta. Sin esto, la sesión no se mantiene entre páginas y el login rebota
 * (bucle). No redirige ni bloquea nada: solo mantiene viva la sesión.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresca la sesión (no usar el resultado para decidir nada aquí).
  await supabase.auth.getUser()

  return response
}

export const config = {
  // Corre en páginas; excluye estáticos, API (auth propia), el callback y assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
