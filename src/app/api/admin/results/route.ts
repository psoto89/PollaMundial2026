/**
 * POST /api/admin/results
 * Carga o edita resultados de partidos (marcador + estado + minuto).
 * También maneja resultados de clasificados, semis y preguntas.
 * Dispara recalc automático al terminar un partido.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncQualifyFromResults } from '@/lib/autoQualify'

// ─── Schemas individuales ─────────────────────────────────────
const matchResultSchema = z.object({
  type: z.literal('match'),
  matchId: z.string().uuid(),
  golesLocal: z.number().int().min(0).nullable(),
  golesVisitante: z.number().int().min(0).nullable(),
  estado: z.enum(['scheduled', 'live', 'finished']),
  minuto: z.number().int().min(0).max(120).nullable().optional(),
  kickoffAt: z.string().nullable().optional(),
  // Eliminación: equipo que clasificó (90' puede ser empate → ET/penales deciden).
  // El marcador (goles_*) es SIEMPRE de 90'+reposición; el avance se guarda aparte.
  advancerTeamId: z.string().uuid().nullable().optional(),
})

const officialResultSchema = z.object({
  type: z.enum(['qualify', 'semis', 'question']),
  key: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
})

type MatchResultInput = z.infer<typeof matchResultSchema>
type OfficialResultInput = z.infer<typeof officialResultSchema>

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = await req.json() as { type?: string }
    const db = createAdminClient()

    // Enrutar por el campo `type`
    if (body.type === 'match') {
      const parsed = matchResultSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
      }
      return await handleMatchResult(db, parsed.data, req)
    }

    if (body.type === 'qualify' || body.type === 'semis' || body.type === 'question') {
      const parsed = officialResultSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
      }
      return await handleOfficialResult(db, parsed.data)
    }

    return NextResponse.json({ error: 'type inválido' }, { status: 400 })
  } catch (error) {
    console.error('[POST /api/admin/results]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

async function handleMatchResult(
  db: ReturnType<typeof createAdminClient>,
  data: MatchResultInput,
  req: NextRequest,
) {
  const updateData: Record<string, unknown> = {
    goles_local:     data.golesLocal,
    goles_visitante: data.golesVisitante,
    estado:          data.estado,
    minuto:          data.minuto ?? null,
    kickoff_at:      data.kickoffAt ?? null,
    // Marcar que el último update fue manual → protege de sobrescritura por webhook
    last_source:     'manual',
    last_source_at:  new Date().toISOString(),
  }
  // Solo tocar el clasificado si el form lo envió (evita borrarlo en ediciones parciales)
  if (data.advancerTeamId !== undefined) {
    updateData.advancer_team_id = data.advancerTeamId
  }

  const { error } = await db
    .from('matches')
    .update(updateData)
    .eq('id', data.matchId)
  if (error) throw new Error(`match update: ${error.message}`)

  // Si el partido terminó, recalcular todos los puntos.
  if (data.estado === 'finished' && data.golesLocal !== null) {
    // 1) Actualizar clasificados oficiales (1º/2º y mejores terceros cuando
    //    cierren los 12 grupos). No bloqueante: si falla, no rompe el guardado.
    try {
      await syncQualifyFromResults(db)
    } catch (e) {
      console.error('[handleMatchResult] auto-qualify falló (no bloqueante)', e)
    }

    // 2) Recalc COMPLETO siempre (grupos + eliminación + clasificados + semis +
    //    preguntas). Antes solo corría si cambiaban los clasificados, por lo que
    //    un partido de ELIMINACIÓN al terminar no actualizaba total_eliminacion.
    try {
      const res = await fetch(new URL('/api/admin/recalc', req.url), {
        method: 'POST',
        headers: { 'x-internal-secret': process.env.ADMIN_SESSION_SECRET ?? '' },
      })
      if (!res.ok) {
        console.error('[handleMatchResult] recalc interno falló:', res.status)
      }
    } catch (e) {
      console.error('[handleMatchResult] recalc interno falló', e)
    }
  }

  return NextResponse.json({ ok: true })
}

async function handleOfficialResult(
  db: ReturnType<typeof createAdminClient>,
  data: OfficialResultInput,
) {
  const { error } = await db
    .from('official_results')
    .upsert(
      { scope: data.type, key: data.key, value: data.value },
      { onConflict: 'scope,key' },
    )
  if (error) throw new Error(`official_results upsert: ${error.message}`)
  return NextResponse.json({ ok: true })
}

