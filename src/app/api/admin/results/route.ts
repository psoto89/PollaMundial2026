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
import { scoreGroupMatch } from '@/lib/scoring'

// ─── Schemas individuales ─────────────────────────────────────
const matchResultSchema = z.object({
  type: z.literal('match'),
  matchId: z.string().uuid(),
  golesLocal: z.number().int().min(0).nullable(),
  golesVisitante: z.number().int().min(0).nullable(),
  estado: z.enum(['scheduled', 'live', 'finished']),
  minuto: z.number().int().min(0).max(120).nullable().optional(),
  kickoffAt: z.string().nullable().optional(),
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
      return await handleMatchResult(db, parsed.data)
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
) {
  const { error } = await db
    .from('matches')
    .update({
      goles_local:     data.golesLocal,
      goles_visitante: data.golesVisitante,
      estado:          data.estado,
      minuto:          data.minuto ?? null,
      kickoff_at:      data.kickoffAt ?? null,
      // Marcar que el último update fue manual → protege de sobrescritura por webhook
      last_source:     'manual',
      last_source_at:  new Date().toISOString(),
    })
    .eq('id', data.matchId)
  if (error) throw new Error(`match update: ${error.message}`)

  // Si el partido terminó, recalcular puntos de grupos automáticamente
  if (data.estado === 'finished' && data.golesLocal !== null) {
    await recalcGroupScores(db)
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

/** Recalcula los puntos de grupos para todos los participantes */
async function recalcGroupScores(db: ReturnType<typeof createAdminClient>) {
  const { data: finishedMatches } = await db
    .from('matches')
    .select('id, goles_local, goles_visitante')
    .eq('estado', 'finished')
    .eq('fase', 'grupos')
    .not('goles_local', 'is', null)

  if (!finishedMatches || finishedMatches.length === 0) return

  const { data: allPreds } = await db
    .from('predictions_group')
    .select('participant_id, match_id, pred_local, pred_visitante')

  if (!allPreds) return

  type FinishedMatch = { id: string; goles_local: number; goles_visitante: number }
  const matchResultMap = new Map(
    (finishedMatches as FinishedMatch[]).map((m) => [
      m.id,
      { golesLocal: m.goles_local, golesVisitante: m.goles_visitante },
    ]),
  )

  type Pred = { participant_id: string; match_id: string; pred_local: number; pred_visitante: number }
  const predsByParticipant = new Map<string, Pred[]>()
  for (const pred of allPreds as Pred[]) {
    const list = predsByParticipant.get(pred.participant_id) ?? []
    list.push(pred)
    predsByParticipant.set(pred.participant_id, list)
  }

  const updates: { participant_id: string; total_grupos: number }[] = []
  for (const [participantId, preds] of predsByParticipant.entries()) {
    let totalGrupos = 0
    for (const pred of preds) {
      const result = matchResultMap.get(pred.match_id)
      if (!result) continue
      totalGrupos += scoreGroupMatch(
        { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
        { golesLocal: result.golesLocal, golesVisitante: result.golesVisitante },
      ).total
    }
    updates.push({ participant_id: participantId, total_grupos: totalGrupos })
  }

  for (const upd of updates) {
    await db
      .from('scores_cache')
      .update({ total_grupos: upd.total_grupos, updated_at: new Date().toISOString() })
      .eq('participant_id', upd.participant_id)
  }

  await updateTotals(db)
}

async function updateTotals(db: ReturnType<typeof createAdminClient>) {
  const { data: scores } = await db
    .from('scores_cache')
    .select('participant_id, total_grupos, total_clasificados, total_semis, total_preguntas')

  if (!scores) return

  type ScoreRow = {
    participant_id: string
    total_grupos: number
    total_clasificados: number
    total_semis: number
    total_preguntas: number
  }

  for (const s of scores as ScoreRow[]) {
    const total = (s.total_grupos ?? 0) + (s.total_clasificados ?? 0) +
                  (s.total_semis ?? 0) + (s.total_preguntas ?? 0)
    await db
      .from('scores_cache')
      .update({ total, updated_at: new Date().toISOString() })
      .eq('participant_id', s.participant_id)
  }
}
