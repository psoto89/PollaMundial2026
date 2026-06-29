/**
 * POST /api/admin/bracket/seed
 * Crea automáticamente los 16 partidos de 16avos (R32) del cuadro a partir de las
 * posiciones de la fase de grupos. Resuelve los feeders de bracket2026:
 *   '1A'/'2C' → 1º/2º del grupo (computeGroupStandings)
 *   '3° (...)' → uno de los 8 mejores terceros (computeBestThirds), en orden de slot.
 * Idempotente: salta los slots que ya tienen partido. Los slots sin equipos
 * resolubles todavía (p.ej. terceros aún indefinidos) se reportan en `missing`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeGroupStandings,
  computeBestThirds,
  type StandingMatch,
  type StandingTeam,
} from '@/lib/standings'
import { BRACKET_2026 } from '@/config/bracket2026'

export async function POST(req: NextRequest) {
  try {
    const internalSecret = req.headers.get('x-internal-secret')
    const isInternal = internalSecret && internalSecret === process.env.ADMIN_SESSION_SECRET
    if (!isInternal && !(await verifyAdminSession())) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const db = createAdminClient()

    const [{ data: teamsRaw }, { data: matchesRaw }, { data: existingRaw }, { data: maxRow }] =
      await Promise.all([
        db.from('teams').select('id, nombre, grupo'),
        db.from('matches')
          .select('equipo_local_id, equipo_visitante_id, goles_local, goles_visitante')
          .eq('fase', 'grupos'),
        db.from('matches').select('bracket_slot').not('bracket_slot', 'is', null),
        db.from('matches').select('match_index').order('match_index', { ascending: false }).limit(1).maybeSingle(),
      ])

    const teams = (teamsRaw ?? []) as { id: string; nombre: string; grupo: string }[]
    if (teams.length === 0) {
      return NextResponse.json({ error: 'No hay equipos cargados' }, { status: 400 })
    }
    const gmatches = (matchesRaw ?? []) as {
      equipo_local_id: string; equipo_visitante_id: string
      goles_local: number | null; goles_visitante: number | null
    }[]
    const usedSlots = new Set(
      ((existingRaw ?? []) as { bracket_slot: string | null }[]).map((m) => m.bracket_slot),
    )
    let nextIndex = ((maxRow as { match_index: number } | null)?.match_index ?? -1) + 1

    // Partidos de grupos finalizados → insumo de la tabla de posiciones
    const standingMatches: StandingMatch[] = gmatches
      .filter((m) => m.goles_local != null && m.goles_visitante != null)
      .map((m) => ({
        equipoLocalId: m.equipo_local_id,
        equipoVisitanteId: m.equipo_visitante_id,
        golesLocal: m.goles_local!,
        golesVisitante: m.goles_visitante!,
      }))

    // Posiciones por grupo + lista de terceros
    const groups = [...new Set(teams.map((t) => t.grupo))].sort()
    const posByGroup = new Map<string, Record<number, string | undefined>>()
    const thirds: { teamId: string; teamNombre: string; grupo: string; pts: number; gd: number; gf: number }[] = []
    for (const g of groups) {
      const gteams: StandingTeam[] = teams
        .filter((t) => t.grupo === g)
        .map((t) => ({ teamId: t.id, teamNombre: t.nombre, grupo: g }))
      if (gteams.length === 0) continue
      const { rows } = computeGroupStandings(standingMatches, gteams)
      posByGroup.set(g, { 1: rows[0]?.teamId, 2: rows[1]?.teamId, 3: rows[2]?.teamId })
      if (rows[2]) {
        thirds.push({
          teamId: rows[2].teamId, teamNombre: rows[2].teamNombre, grupo: g,
          pts: rows[2].pts, gd: rows[2].gd, gf: rows[2].gf,
        })
      }
    }
    const bestThirds = computeBestThirds(thirds, 8).qualified
    let thirdIdx = 0

    const resolveFeeder = (feeder: string): string | null => {
      const m = feeder.match(/^(\d)([A-L])$/)
      if (m) return posByGroup.get(m[2])?.[Number(m[1])] ?? null
      if (feeder.trim().startsWith('3')) return bestThirds[thirdIdx++]?.teamId ?? null
      return null
    }

    const r32 = BRACKET_2026.filter((s) => s.round === 'dieciseisavos').sort((a, b) => a.order - b.order)
    // Kickoffs escalonados a futuro → abiertos para pronosticar (ajustables luego)
    const baseMs = Date.now() + 2 * 24 * 60 * 60 * 1000
    const created: string[] = []
    const skipped: string[] = []
    const missing: string[] = []

    for (let i = 0; i < r32.length; i++) {
      const slot = r32[i]
      if (usedSlots.has(slot.slot)) { skipped.push(slot.slot); continue }
      const localId = resolveFeeder(slot.localFeeder)
      const visitanteId = resolveFeeder(slot.visitanteFeeder)
      if (!localId || !visitanteId || localId === visitanteId) { missing.push(slot.slot); continue }

      const kickoff = new Date(baseMs + i * 30 * 60 * 1000).toISOString()
      const { error } = await db.from('matches').insert({
        fase: 'dieciseisavos',
        grupo: null,
        equipo_local_id: localId,
        equipo_visitante_id: visitanteId,
        match_index: nextIndex++,
        kickoff_at: kickoff,
        estado: 'scheduled',
        bracket_slot: slot.slot,
      })
      if (error) missing.push(`${slot.slot} (${error.message})`)
      else created.push(slot.slot)
    }

    return NextResponse.json({ ok: true, created: created.length, skipped: skipped.length, missing })
  } catch (error) {
    console.error('[POST /api/admin/bracket/seed]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
