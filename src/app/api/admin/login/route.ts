import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminToken, adminSessionCookieHeader } from '@/lib/auth'

const schema = z.object({
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const { password } = parsed.data
    if (password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }

    const token = await createAdminToken()
    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', adminSessionCookieHeader(token))
    return res
  } catch (error) {
    console.error('[POST /api/admin/login]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
