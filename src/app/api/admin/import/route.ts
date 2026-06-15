/**
 * POST /api/admin/import
 * Acepta un archivo Excel (multipart), lo parsea, y devuelve el preview.
 * Acepta también { confirm: true } para commitear los datos en Supabase.
 *
 * Flujo:
 *   1. POST con el archivo → { preview: ParsedExcel }
 *   2. POST con { confirm: true, preview: ParsedExcel } → inserta/upsert en Supabase
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseExcel } from '@/lib/excelParser'
import type { ParsedExcel, ParsedParticipant } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await verifyAdminSession()
    if (!isAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const contentType = req.headers.get('content-type') ?? ''

    // ── Fase 1: parse + preview ───────────────────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'No se encontró el archivo' }, { status: 400 })
      }

      const buffer = await file.arrayBuffer()
      const preview = parseExcel(buffer)
      return NextResponse.json({ preview })
    }

    // ── Fase 2: commit ────────────────────────────────────────────────────────
    const body = await req.json()
    if (!body.confirm || !body.preview) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
    }

    const preview = body.preview as ParsedExcel
    const db = createAdminClient()

    // 1. Upsert equipos
    if (preview.teams.length > 0) {
      const { error: teamError } = await db
        .from('teams')
        .upsert(preview.teams.map((t) => ({ nombre: t.nombre, grupo: t.grupo })), {
          onConflict: 'nombre',
        })
      if (teamError) throw new Error(`teams upsert: ${teamError.message}`)
    }

    // Cargar todos los equipos para obtener IDs
    const { data: teamsData, error: teamsLoadError } = await db
      .from('teams')
      .select('id, nombre')
    if (teamsLoadError) throw new Error(`teams load: ${teamsLoadError.message}`)
    const teamIdByNombre = new Map(teamsData!.map((t: { id: string; nombre: string }) => [t.nombre, t.id]))
    // Mapa secundario: nombre normalizado (sin acentos, sin puntuación, minúsculas) → id
    // Cubre variantes como MEXICO→México, N Zelanda→N. Zelanda, trailing spaces, etc.
    function normalizeName(s: string): string {
      return s.trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
        .replace(/[.,'\-]/g, '')                  // quitar puntuación
        .replace(/\s+/g, ' ').trim()              // normalizar espacios
    }
    const teamIdByNormalized = new Map(
      teamsData!.map((t: { id: string; nombre: string }) => [normalizeName(t.nombre), t.id])
    )
    function lookupTeamId(nombre: string): string | undefined {
      return teamIdByNombre.get(nombre) ?? teamIdByNormalized.get(normalizeName(nombre))
    }

    // 2. Upsert partidos de grupo
    const matchRows = preview.matches.map((m) => ({
      fase: 'grupos' as const,
      grupo: m.grupo,
      equipo_local_id: teamIdByNombre.get(m.localTeam)!,
      equipo_visitante_id: teamIdByNombre.get(m.visitanteTeam)!,
      match_index: m.matchIndex,
      estado: 'scheduled' as const,
    }))
    if (matchRows.length > 0) {
      const { error: matchError } = await db
        .from('matches')
        .upsert(matchRows, { onConflict: 'match_index' })
      if (matchError) throw new Error(`matches upsert: ${matchError.message}`)
    }

    // Cargar partidos para obtener IDs
    const { data: matchesData, error: matchesLoadError } = await db
      .from('matches')
      .select('id, match_index')
      .eq('fase', 'grupos')
    if (matchesLoadError) throw new Error(`matches load: ${matchesLoadError.message}`)
    const matchIdByIndex = new Map(matchesData!.map((m: { id: string; match_index: number }) => [m.match_index, m.id]))

    // 3. Upsert participantes y sus pronósticos
    for (const p of preview.participants) {
      // Upsert participante
      const { data: participantData, error: partError } = await db
        .from('participants')
        .upsert(
          { sheet_alias: p.sheetAlias, nombre: p.nombre },
          { onConflict: 'sheet_alias' },
        )
        .select('id')
        .single()
      if (partError) throw new Error(`participant upsert ${p.sheetAlias}: ${partError.message}`)

      const participantId = participantData!.id

      // Pronósticos de grupos
      const groupPredRows = p.predictionsGroup
        .filter((pr) => pr.predLocal !== null && pr.predVisitante !== null)
        .map((pr) => ({
          participant_id: participantId,
          match_id: matchIdByIndex.get(pr.matchIndex)!,
          pred_local: pr.predLocal!,
          pred_visitante: pr.predVisitante!,
        }))
        .filter((r) => r.match_id) // descartar si el match_id no existe
      if (groupPredRows.length > 0) {
        const { error } = await db
          .from('predictions_group')
          .upsert(groupPredRows, { onConflict: 'participant_id,match_id' })
        if (error) throw new Error(`pred_group ${p.sheetAlias}: ${error.message}`)
      }

      // Pronósticos de clasificados
      const qualPredRows = p.predictionsQualify
        .filter((pr) => pr.team && lookupTeamId(pr.team) !== undefined)
        .map((pr) => ({
          participant_id: participantId,
          grupo: pr.grupo,
          posicion: pr.posicion,
          team_id: lookupTeamId(pr.team)!,
        }))
      if (qualPredRows.length > 0) {
        const { error } = await db
          .from('predictions_qualify')
          .upsert(qualPredRows, { onConflict: 'participant_id,grupo,posicion' })
        if (error) throw new Error(`pred_qualify ${p.sheetAlias}: ${error.message}`)
      }

      // Pronósticos de semis
      const semisPredRows = p.predictionsSemis
        .filter((pr) => pr.team && lookupTeamId(pr.team) !== undefined)
        .map((pr) => ({
          participant_id: participantId,
          puesto: pr.puesto,
          team_id: lookupTeamId(pr.team)!,
        }))
      if (semisPredRows.length > 0) {
        const { error } = await db
          .from('predictions_semis')
          .upsert(semisPredRows, { onConflict: 'participant_id,puesto' })
        if (error) throw new Error(`pred_semis ${p.sheetAlias}: ${error.message}`)
      }

      // Preguntas
      const questionRows = p.predictionsQuestions
        .filter((pr) => pr.respuesta !== null)
        .map((pr) => ({
          participant_id: participantId,
          pregunta_key: pr.key,
          respuesta: String(pr.respuesta),
        }))
      if (questionRows.length > 0) {
        const { error } = await db
          .from('predictions_questions')
          .upsert(questionRows, { onConflict: 'participant_id,pregunta_key' })
        if (error) throw new Error(`pred_questions ${p.sheetAlias}: ${error.message}`)
      }

      // Inicializar scores_cache en 0 solo si aún no existe (no sobrescribir puntos calculados)
      await db
        .from('scores_cache')
        .upsert(
          { participant_id: participantId, total: 0, total_grupos: 0, total_clasificados: 0, total_semis: 0, total_preguntas: 0 },
          { onConflict: 'participant_id', ignoreDuplicates: true },
        )
    }

    // 4. Upsert prize_pool
    const { error: prizeError } = await db
      .from('prize_pool')
      .upsert({
        id: '00000000-0000-0000-0000-000000000001',
        pct_primero: preview.prizePool.pctPrimero,
        pct_segundo: preview.prizePool.pctSegundo,
        pct_grupos:  preview.prizePool.pctGrupos,
      })
    if (prizeError) console.error('[import] prize_pool:', prizeError.message)

    return NextResponse.json({
      ok: true,
      message: `Importados ${preview.participants.length} participantes, ${preview.teams.length} equipos, ${preview.matches.length} partidos.`,
    })
  } catch (error) {
    console.error('[POST /api/admin/import]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
