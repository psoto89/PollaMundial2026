/**
 * POST /api/webhooks/live
 *
 * Receptor de eventos en vivo de BallDontLie para World Cup 2026.
 *
 * Flujo:
 *   1. Leer raw body → verificar firma HMAC-SHA256 (X-BDL-Webhook-Signature)
 *   2. Parsear envelope: { id, type, game_id, payload }
 *   3. Ignorar eventos que no afectan marcador/estado
 *   4. Resolver game_id → matches.external_id
 *   5. Respetar last_source = 'manual': si fue manual hace < 10 min, ignorar webhook
 *   6. Actualizar matches (goles_local, goles_visitante, minuto, estado, last_source)
 *   7. Responder 200 (idempotente: SET absoluto, no incremento)
 *
 * El UPDATE en Supabase dispara postgres_changes → Realtime → clientes se actualizan solos.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  BdlWebhookEnvelope,
  GAME_EVENT_TYPES,
  extractMatchState,
} from '@/config/liveWebhookMap'

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Si el admin actualizó el marcador manualmente hace menos de N minutos, el webhook no pisa. */
const MANUAL_LOCK_MINUTES = 10

/** Nombre de la env var del secret de firma. */
const WEBHOOK_SECRET = process.env.BALLDONTLIE_WEBHOOK_SECRET

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verifica la firma HMAC-SHA256 del webhook de BallDontLie.
 *
 * Algoritmo confirmado (docs BallDontLie):
 *   message  = `${timestamp}.${rawBody}`
 *   expected = "v1=" + HMAC-SHA256(message, secret).hex()
 *   Comparar con timingSafeEqual contra header X-BDL-Webhook-Signature
 */
function verifySignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const message  = `${timestamp}.${rawBody}`
  const expected = 'v1=' + crypto.createHmac('sha256', secret).update(message).digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    )
  } catch {
    // Buffer lengths diferentes → firma inválida
    return false
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 0. Verificar que tenemos el secret configurado
  if (!WEBHOOK_SECRET) {
    console.error('[webhook/live] BALLDONTLIE_WEBHOOK_SECRET no configurado')
    return NextResponse.json({ error: 'Webhook no configurado' }, { status: 500 })
  }

  // 1. Leer raw body como texto (necesario para verificar firma)
  const rawBody = await request.text()

  // 2. Extraer headers de verificación
  const signature = request.headers.get('x-bdl-webhook-signature') ?? ''
  const timestamp = request.headers.get('x-bdl-webhook-timestamp') ?? ''
  const eventId   = request.headers.get('x-bdl-webhook-id') ?? ''

  if (!signature || !timestamp) {
    console.warn('[webhook/live] Headers de firma ausentes', { eventId })
    return NextResponse.json({ error: 'Firma requerida' }, { status: 401 })
  }

  // 3. Verificar firma
  const isValid = verifySignature(rawBody, timestamp, signature, WEBHOOK_SECRET)
  if (!isValid) {
    console.warn('[webhook/live] Firma inválida', {
      eventId,
      timestamp,
      signatureHead: signature.slice(0, 10) + '…',
    })
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  // 4. Parsear payload
  let envelope: BdlWebhookEnvelope
  try {
    envelope = JSON.parse(rawBody) as BdlWebhookEnvelope
  } catch {
    console.error('[webhook/live] JSON inválido', rawBody.slice(0, 200))
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { type: eventType, game_id: gameId, payload } = envelope

  // Log del payload crudo en desarrollo / primer setup.
  // Esto te permite ver el shape real del payload para verificar liveWebhookMap.ts.
  if (process.env.NODE_ENV !== 'production' || process.env.LOG_WEBHOOK_PAYLOAD === 'true') {
    console.log('[webhook/live] Raw payload recibido:', JSON.stringify({
      eventType,
      gameId,
      eventId,
      payload,
    }, null, 2))
  }

  // 5. Ignorar eventos que no afectan marcador ni estado
  if (!GAME_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'event_not_tracked' })
  }

  // 6. Extraer estado del partido del payload
  const { golesLocal, golesVisitante, minuto, estado } = extractMatchState(eventType, payload ?? {})

  // Si no podemos extraer ningún dato útil, loguear pero no fallar
  if (golesLocal === null && golesVisitante === null && estado === null) {
    console.warn('[webhook/live] No se pudo extraer datos del payload', {
      eventType,
      gameId,
      payloadKeys: Object.keys(payload ?? {}),
    })
    // Aún así responder 200 para que BallDontLie no reintente indefinidamente
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_extractable_data' })
  }

  // 7. Resolver game_id → matches.external_id
  const db = createAdminClient()
  const { data: match, error: matchError } = await db
    .from('matches')
    .select('id, goles_local, goles_visitante, estado, last_source, last_source_at')
    .eq('external_id', String(gameId))
    .single()

  if (matchError || !match) {
    // Partido no encontrado: puede que no esté sembrado aún o external_id no mapeado.
    // Loguear como info, no como error — los partidos del Mundial se agregan al importar fixtures.
    console.info('[webhook/live] Partido no encontrado con external_id', {
      gameId,
      eventType,
      hint: 'Asegúrate de que el external_id del partido esté seteado al importar fixtures',
    })
    return NextResponse.json({ ok: true, skipped: true, reason: 'match_not_found', gameId })
  }

  // 8. Proteger actualizaciones manuales recientes
  //    Si el admin actualizó el marcador a mano hace < MANUAL_LOCK_MINUTES min, ignorar webhook.
  if (match.last_source === 'manual' && match.last_source_at) {
    const minutosDesdeManual = (Date.now() - new Date(match.last_source_at as string).getTime()) / 60000
    if (minutosDesdeManual < MANUAL_LOCK_MINUTES) {
      console.info('[webhook/live] Ignorando webhook: update manual reciente', {
        matchId: match.id,
        minutosDesdeManual: minutosDesdeManual.toFixed(1),
        lockMinutes: MANUAL_LOCK_MINUTES,
      })
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'manual_lock',
        minutosDesdeManual: minutosDesdeManual.toFixed(1),
      })
    }
  }

  // 9. Construir el update (solo campos que tenemos datos)
  //    Idempotente: SET absoluto, nunca incrementamos.
  const updateData: Record<string, unknown> = {
    last_source:    'webhook',
    last_source_at: new Date().toISOString(),
  }

  if (golesLocal !== null)     updateData['goles_local']     = golesLocal
  if (golesVisitante !== null) updateData['goles_visitante'] = golesVisitante
  if (minuto !== null)         updateData['minuto']          = minuto
  if (estado !== null)         updateData['estado']          = estado

  const { error: updateError } = await db
    .from('matches')
    .update(updateData)
    .eq('id', match.id)

  if (updateError) {
    console.error('[webhook/live] Error al actualizar partido', {
      matchId: match.id,
      updateData,
      error: updateError.message,
    })
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  console.info('[webhook/live] Partido actualizado', {
    matchId: match.id,
    gameId,
    eventType,
    golesLocal,
    golesVisitante,
    minuto,
    estado,
  })

  // 10. Si el partido terminó, disparar recálculo de scores en background
  //     No esperamos la respuesta (fire and forget) para responder 200 rápido a BallDontLie.
  if (estado === 'finished') {
    void triggerRecalc()
  }

  return NextResponse.json({ ok: true, matchId: match.id })
}

/**
 * Dispara el recálculo de scores_cache en background.
 * Fire-and-forget: no bloquea la respuesta del webhook.
 */
async function triggerRecalc(): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const recalcSecret = process.env.ADMIN_SESSION_SECRET
    if (!recalcSecret) return

    await fetch(`${baseUrl}/api/admin/recalc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Usamos el secret como header interno (no es la cookie — es server-to-server)
        'x-internal-secret': recalcSecret,
      },
    })
  } catch (err) {
    // No crítico: el admin puede disparar recalc manualmente desde /admin
    console.warn('[webhook/live] Error al disparar recalc automático', err)
  }
}
