import { NextResponse, type NextRequest } from 'next/server'
import { verifyAdminTokenFromRequest } from '@/lib/auth'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Solo proteger rutas /admin (excepto /admin/login)
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const isAdmin = await verifyAdminTokenFromRequest(req)
    if (!isAdmin) {
      const loginUrl = new URL('/admin/login', req.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
