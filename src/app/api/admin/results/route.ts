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
import { syncSemisFromResults } from '@/lib/autoSemis'
import { advanceBracket } from '@/lib/advanceBracket'

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
      return await handleOfficialResult(db, parsed.data, req)
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
    // Marcar que el último update fue manual → protege de sobrescritura por webhook
    last_source:     'manual',
    last_source_at:  new Date().toISOString(),
  }
  // ⚠️ Solo tocar kickoff_at si el form lo envió. Escribirlo siempre lo ponía en NULL
  // (el form no lo manda), y un kickoff NULL reabría el partido para pronóstico.
  if (data.kickoffAt !== undefined) {
    updateData.kickoff_at = data.kickoffAt
  }
  // Solo tocar el clasificado si el form lo envió (evita borrarlo en ediciones parciales)
  if (data.advancerTeamId !== undefined) {
    // Validar que el clasificado sea uno de los dos equipos del partido
    if (data.advancerTeamId !== null) {
      const { data: m } = await db
        .from('matches')
        .select('equipo_local_id, equipo_visitante_id')
        .eq('id', data.matchId)
        .single()
      if (m && data.advancerTeamId !== m.equipo_local_id && data.advancerTeamId !== m.equipo_visitante_id) {
        return NextResponse.json({ error: 'El clasificado no es uno de los equipos del partido' }, { status: 400 })
      }
    }
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

    // Avanzar la llave oficial: crea la siguiente ronda si ya hay ganadores
    try {
      await advanceBracket(db)
    } catch (e) {
      console.error('[handleMatchResult] advanceBracket falló (no bloqueante)', e)
    }

    // Derivar semifinalistas/puestos finales de la Polla 1 desde los cuartos/final
    // ya finalizados (official_results scope='semis'). Automático, sin carga manual.
    try {
      await syncSemisFromResults(db)
    } catch (e) {
      console.error('[handleMatchResult] auto-semis falló (no bloqueante)', e)
    }

    // 2) Recalc COMPLETO siempre (grupos + eliminación + clasificados + semis +
    //    preguntas). Antes solo corría si cambiaban los clasificados, por lo que
    //    un partido de ELIMINACIÓN al terminar no actualizaba total_eliminacion.
    await triggerRecalc(req)
  }

  return NextResponse.json({ ok: true })
}

async function handleOfficialResult(
  db: ReturnType<typeof createAdminClient>,
  data: OfficialResultInput,
  req: NextRequest,
) {
  const { error } = await db
    .from('official_results')
    .upsert(
      { scope: data.type, key: data.key, value: data.value },
      { onConflict: 'scope,key' },
    )
  if (error) throw new Error(`official_results upsert: ${error.message}`)

  // Recalcular puntos tras guardar el resultado oficial. Sin esto, cargar
  // semifinalistas/clasificados/respuestas NO aplicaba puntos hasta que un
  // partido terminara o se pulsara "Recalcular" manualmente.
  await triggerRecalc(req)

  return NextResponse.json({ ok: true })
}

/**
 * Dispara el recálculo completo de scores_cache vía llamada interna
 * server-to-server (auth por header x-internal-secret). No bloqueante:
 * si falla, se loggea pero no rompe el guardado.
 */
async function triggerRecalc(req: NextRequest): Promise<void> {
  try {
    const res = await fetch(new URL('/api/admin/recalc', req.url), {
      method: 'POST',
      headers: { 'x-internal-secret': process.env.ADMIN_SESSION_SECRET ?? '' },
    })
    if (!res.ok) {
      console.error('[results] recalc interno falló:', res.status)
    }
  } catch (e) {
    console.error('[results] recalc interno falló', e)
  }
}

