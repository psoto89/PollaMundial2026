/**
 * POST /api/admin/bracket/seed
 * Carga la llave OFICIAL de 16avos (Mundial 2026) en los slots R32-01..R32-16,
 * reemplazando cualquier partido de eliminación previo. Empareja los nombres
 * oficiales contra la tabla `teams` (normalizando acentos/mayúsculas + alias).
 *
 * Caso especial pedido: R32-03 (Sudáfrica vs Canadá) queda FINALIZADO con Canadá
 * ganando 1-0 (marcador 0-1, clasifica Canadá). Se fija bracket_activated_at = ahora,
 * así ese partido (ya jugado) no participa y los demás (a futuro) quedan abiertos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { advanceBracket } from '@/lib/advanceBracket'

// Llave oficial (AS · "Así quedan los cruces de dieciseisavos"). Izquierda arriba→abajo
// = R32-01..08; derecha arriba→abajo = R32-09..16 (consistente con bracket2026.ts).
const OFFICIAL_R32: { slot: string; local: string; visitante: string }[] = [
  { slot: 'R32-01', local: 'Alemania', visitante: 'Paraguay' },
  { slot: 'R32-02', local: 'Francia', visitante: 'Suecia' },
  { slot: 'R32-03', local: 'Sudáfrica', visitante: 'Canadá' },
  { slot: 'R32-04', local: 'Países Bajos', visitante: 'Marruecos' },
  { slot: 'R32-05', local: 'Portugal', visitante: 'Croacia' },
  { slot: 'R32-06', local: 'España', visitante: 'Austria' },
  { slot: 'R32-07', local: 'USA', visitante: 'Bosnia' },
  { slot: 'R32-08', local: 'Bélgica', visitante: 'Senegal' },
  { slot: 'R32-09', local: 'Brasil', visitante: 'Japón' },
  { slot: 'R32-10', local: 'Costa de Marfil', visitante: 'Noruega' },
  { slot: 'R32-11', local: 'México', visitante: 'Ecuador' },
  { slot: 'R32-12', local: 'Inglaterra', visitante: 'Congo' },
  { slot: 'R32-13', local: 'Argentina', visitante: 'Cabo Verde' },
  { slot: 'R32-14', local: 'Australia', visitante: 'Egipto' },
  { slot: 'R32-15', local: 'Suiza', visitante: 'Argelia' },
  { slot: 'R32-16', local: 'Colombia', visitante: 'Ghana' },
]

// Alias: nombre oficial (normalizado) → posibles nombres en la tabla teams
const ALIASES: Record<string, string[]> = {
  'usa': ['estados unidos', 'estados unidos de america', 'eeuu'],
  'costa de marfil': ['costa de m', 'cote divoire', 'marfil', 'costa marfil'],
  'argelia': ['algeria'],
  'paises bajos': ['holanda', 'netherlands'],
  'congo': ['rd congo', 'republica democratica del congo', 'congo rd'],
  'cabo verde': ['cape verde'],
}

function norm(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const internalSecret = req.headers.get('x-internal-secret')
    const isInternal = internalSecret && internalSecret === process.env.ADMIN_SESSION_SECRET
    if (!isInternal && !(await verifyAdminSession())) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const db = createAdminClient()

    const [{ data: teamsRaw }, { data: maxRow }] = await Promise.all([
      db.from('teams').select('id, nombre'),
      db.from('matches').select('match_index').order('match_index', { ascending: false }).limit(1).maybeSingle(),
    ])
    const teams = (teamsRaw ?? []) as { id: string; nombre: string }[]
    if (teams.length === 0) return NextResponse.json({ error: 'No hay equipos' }, { status: 400 })

    // Mapa normalizado nombre → id (con alias)
    const byNorm = new Map<string, string>()
    for (const t of teams) byNorm.set(norm(t.nombre), t.id)
    const resolve = (name: string): string | null => {
      const n = norm(name)
      if (byNorm.has(n)) return byNorm.get(n)!
      for (const alt of ALIASES[n] ?? []) if (byNorm.has(alt)) return byNorm.get(alt)!
      return null
    }

    // Resolver equipos; los slots con algún equipo faltante se saltan (tolerante)
    const unmatched = new Set<string>()
    const resolved = OFFICIAL_R32.map((m) => {
      const localId = resolve(m.local)
      const visitanteId = resolve(m.visitante)
      if (!localId) unmatched.add(m.local)
      if (!visitanteId) unmatched.add(m.visitante)
      return { ...m, localId, visitanteId }
    })
    const ready = resolved.filter((m) => m.localId && m.visitanteId)
    const skipped = resolved.filter((m) => !m.localId || !m.visitanteId).map((m) => m.slot)

    // Reemplazar: borrar todos los partidos de eliminación previos
    await db.from('matches').delete().neq('fase', 'grupos')

    let nextIndex = ((maxRow as { match_index: number } | null)?.match_index ?? 71) + 1
    const nowMs = Date.now()
    const futureBase = nowMs + 2 * 24 * 60 * 60 * 1000

    const rows = ready.map((m, i) => {
      const isCanada = m.slot === 'R32-03'
      return {
        fase: 'dieciseisavos',
        grupo: null,
        equipo_local_id: m.localId,
        equipo_visitante_id: m.visitanteId,
        match_index: nextIndex++,
        bracket_slot: m.slot,
        // R32-03 ya jugado (ayer); el resto a futuro (abiertos para pronosticar)
        kickoff_at: new Date(isCanada ? nowMs - 24 * 60 * 60 * 1000 : futureBase + i * 30 * 60 * 1000).toISOString(),
        estado: isCanada ? 'finished' : 'scheduled',
        goles_local: isCanada ? 0 : null,
        goles_visitante: isCanada ? 1 : null,
        advancer_team_id: isCanada ? m.visitanteId : null, // Canadá clasifica
        last_source: 'manual',
        last_source_at: new Date().toISOString(),
      }
    })

    const { error: insErr } = await db.from('matches').insert(rows)
    if (insErr) return NextResponse.json({ error: `insert: ${insErr.message}` }, { status: 500 })

    // "Desde hoy hacia adelante": activar ahora → el partido ya jugado no participa
    await db.from('app_config').update({ bracket_activated_at: new Date().toISOString() }).eq('id', 1)

    // Avanzar la llave oficial con los partidos ya finalizados (cascada)
    try { await advanceBracket(db) } catch (e) { console.error('[seed] advanceBracket', e) }

    // Recalcular (el de Canadá ya finalizó)
    try {
      await fetch(new URL('/api/admin/recalc', req.url), {
        method: 'POST',
        headers: { 'x-internal-secret': process.env.ADMIN_SESSION_SECRET ?? '' },
      })
    } catch { /* no bloqueante */ }

    return NextResponse.json({ ok: true, created: rows.length, canadaClosed: true })
  } catch (error) {
    console.error('[POST /api/admin/bracket/seed]', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
