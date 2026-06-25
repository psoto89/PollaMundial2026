import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { timingSafeEqual } from 'crypto'
import { createAdminToken, adminSessionCookieHeader } from '@/lib/auth'

const schema = z.object({
  password: z.string().min(1),
})

// ── Rate limit best-effort en memoria por IP ─────────────────────────────────
// No es perfecto en serverless (cada instancia tiene su mapa), pero sube el
// costo de un ataque de fuerza bruta sin dependencias externas.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 10 * 60 * 1000 // 10 min
const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  rec.count++
  return rec.count > MAX_ATTEMPTS
}

/** Comparación de strings en tiempo constante (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'anonymous'
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera unos minutos.' },
        { status: 429 },
      )
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const expected = process.env.ADMIN_PASSWORD
    if (!expected) {
      console.error('[POST /api/admin/login] ADMIN_PASSWORD no configurado')
      return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }

    if (!safeEqual(parsed.data.password, expected)) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }

    // Login correcto → limpiar el contador de intentos de esa IP
    attempts.delete(ip)

    const token = await createAdminToken()
    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', adminSessionCookieHeader(token))
    return res
  } catch (error) {
    console.error('[POST /api/admin/login]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
