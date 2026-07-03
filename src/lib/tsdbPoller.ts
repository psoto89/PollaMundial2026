/**
 * lib/tsdbPoller.ts
 *
 * Capa de datos de partidos para el Mundial 2026 — TheSportsDB (Single Developer plan).
 * DOS endpoints únicos:
 *   A) Schedule: GET /api/v2/json/schedule/league/{id}/2026  — fixtures + resultados
 *   B) Livescore: GET /api/v2/json/livescore/{id}           — marcador minuto a minuto
 *
 * Auth: header X-API-KEY: {THESPORTSDB_API_KEY}
 * idEvent es la clave externa — el mismo en schedule y livescore.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  mapTsdbStatus, tsdbTeamToDb, teamPairKey, orientScores,
  penaltyWinnerFromEvent, type TsdbFullEvent,
} from '@/config/theSportsDbMap'
import { syncQualifyFromResults } from '@/lib/autoQualify'
import { advanceBracket } from '@/lib/advanceBracket'

const LEAGUE_ID  = process.env.WORLDCUP_LEAGUE_ID ?? '4429'
const BASE_URL   = 'https://www.thesportsdb.com/api/v2/json'
const MANUAL_LOCK_MS = 30 * 60 * 1000  // 30 minutos

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TsdbEvent {
  idEvent:       string
  strHomeTeam:   string
  strAwayTeam:   string
  intHomeScore:  string | null
  intAwayScore:  string | null
  strStatus:     string
  strProgress?:  string | null   // minuto (solo livescore)
  strTimestamp?: string | null   // kickoff UTC (solo schedule)
  intRound?:     string | null
  strPostponed?: string | null
}

export interface SyncResult {
  updated:        number
  mapped:         number
  notMapped:      number
  newlyFinished:  number
  errors:         string[]
}

// ─── Fetch endpoints ──────────────────────────────────────────────────────────

function apiKey(): string {
  const k = process.env.THESPORTSDB_API_KEY
  if (!k) throw new Error('THESPORTSDB_API_KEY no configurado')
  return k
}

/** Endpoint A: 104 partidos con fixtures + resultados finales */
export async function fetchTsdbSchedule(): Promise<TsdbEvent[]> {
  const res = await fetch(`${BASE_URL}/schedule/league/${LEAGUE_ID}/2026`, {
    headers: { 'X-API-KEY': apiKey() },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`TheSportsDB schedule ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data.schedule ?? []) as TsdbEvent[]
}

/** Endpoint B: partidos en curso (livescore[]=[] si no hay ninguno, HTTP 200) */
export async function fetchTsdbLive(): Promise<TsdbEvent[]> {
  const res = await fetch(`${BASE_URL}/livescore/${LEAGUE_ID}`, {
    headers: { 'X-API-KEY': apiKey() },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`TheSportsDB livescore ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data.livescore ?? []) as TsdbEvent[]
}

/**
 * Evento completo (superset de schedule/livescore). Se usa SOLO cuando un partido
 * de eliminación finaliza empatado (penales) para intentar el ganador de la tanda,
 * dato que schedule/livescore no traen. Devuelve null si falla (queda el fallback
 * manual del admin).
 */
export async function fetchTsdbEvent(idEvent: string): Promise<TsdbFullEvent | null> {
  const res = await fetch(`${BASE_URL}/lookup/event/${idEvent}`, {
    headers: { 'X-API-KEY': apiKey() },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = await res.json()
  // v2 puede envolver en `lookup` o `events`; tomar el primero
  const arr = (data.lookup ?? data.events ?? []) as TsdbFullEvent[]
  return arr[0] ?? null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parsea score string a int. "" o null → null */
function parseScore(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

type OurMatch = {
  id:                  string
  external_id:         string | null
  fase:                string
  equipo_local_id:     string | null
  equipo_visitante_id: string | null
  goles_local:         number | null
  goles_visitante:     number | null
  estado:              string
  advancer_team_id:    string | null
  kickoff_at:          string | null
  last_source:         string | null
  last_source_at:      string | null
}

/**
 * Clasificado automático de un partido de eliminación a partir del marcador.
 * Si hay un ganador en los 90′ → ese equipo avanza. Si es empate (se define por
 * penales), devuelve null: en ese caso el admin elige el clasificado a mano en
 * /admin/results (es el único caso que la API no puede resolver). Grupos → null.
 */
function knockoutAdvancer(
  fase: string,
  orientedLocal: number | null,
  orientedVisitante: number | null,
  localId: string | null,
  visitanteId: string | null,
): string | null {
  if (fase === 'grupos') return null
  if (orientedLocal === null || orientedVisitante === null) return null
  if (orientedLocal > orientedVisitante) return localId
  if (orientedVisitante > orientedLocal) return visitanteId
  return null
}

/**
 * Resuelve el clasificado de un partido de eliminación recién finalizado:
 *   1) ganador decisivo en 90'/alargue → directo del marcador (síncrono).
 *   2) empate (penales) → intenta el evento completo (/lookup/event) para el
 *      ganador de la tanda. Solo se intenta en el CIERRE (freshFinish) y si aún
 *      no hay clasificado, para no pisar la carga manual del admin ni martillar la
 *      API. Si no hay dato utilizable → null (queda el fallback manual).
 */
async function resolveKnockoutAdvancer(params: {
  fase:              string
  orientedLocal:     number | null
  orientedVisitante: number | null
  localId:           string | null
  visitanteId:       string | null
  currentAdvancer:   string | null
  freshFinish:       boolean
  idEvent:           string | null
  ourHomeName:       string
}): Promise<string | null> {
  const { fase, orientedLocal, orientedVisitante, localId, visitanteId } = params
  const direct = knockoutAdvancer(fase, orientedLocal, orientedVisitante, localId, visitanteId)
  if (direct) return direct

  // A partir de aquí: solo eliminación con marcador empatado (posibles penales)
  if (fase === 'grupos') return null
  if (orientedLocal === null || orientedVisitante === null) return null
  if (orientedLocal !== orientedVisitante) return null
  // No pisar un clasificado ya definido (admin) ni gastar lookup fuera del cierre
  if (params.currentAdvancer) return params.currentAdvancer
  if (!params.freshFinish || !params.idEvent) return null

  try {
    const full = await fetchTsdbEvent(params.idEvent)
    if (full) {
      const side = penaltyWinnerFromEvent(full, params.ourHomeName)
      if (side === 'local') return localId
      if (side === 'visitante') return visitanteId
      // Sin campo de penales utilizable: log del shape real para poder cablearlo luego
      console.warn(
        `[tsdb] empate a penales sin ganador en /lookup/event ${params.idEvent}; ` +
        `evento: ${JSON.stringify(full).slice(0, 600)}`,
      )
    }
  } catch (e) {
    console.error(`[tsdb] fetchTsdbEvent(${params.idEvent}) falló`, e)
  }
  return null
}

function isManualLocked(m: OurMatch): boolean {
  if (m.last_source !== 'manual' || !m.last_source_at) return false
  return Date.now() - new Date(m.last_source_at).getTime() < MANUAL_LOCK_MS
}

/** Fire-and-forget: recalcula scores_cache tras un partido terminado */
function triggerRecalc(): void {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const secret = process.env.ADMIN_SESSION_SECRET ?? ''
  fetch(`${appUrl}/api/admin/recalc`, {
    method: 'POST',
    headers: { 'x-internal-secret': secret },
  }).catch(() => {})
}

/**
 * Cierra los grupos completos y escribe los clasificados oficiales (1º/2º y
 * mejores terceros) de forma automática e idempotente. Devuelve true si cambió
 * official_results. Es seguro correrla en cada sync: solo procesa la fase de
 * grupos y reescribe el mismo estado. Sus errores se registran sin abortar el
 * sync. Al ser idempotente, sirve de backfill para grupos ya cerrados antes.
 */
async function reconcileQualifiers(
  db: ReturnType<typeof createAdminClient>,
  result: SyncResult,
): Promise<boolean> {
  try {
    const q = await syncQualifyFromResults(db)
    return q.changed
  } catch (e) {
    result.errors.push(`autoQualify: ${String(e)}`)
    return false
  }
}

// ─── Sync schedule (endpoint A) ───────────────────────────────────────────────

/**
 * Descarga los 72+ partidos del schedule, mapea external_id por nombre de equipo
 * (primera vez) y actualiza kickoff, estado y marcadores para los FT.
 * Se llama 1×/día (cron) + botón manual en /admin.
 */
export async function syncSchedule(): Promise<SyncResult> {
  const result: SyncResult = { updated: 0, mapped: 0, notMapped: 0, newlyFinished: 0, errors: [] }

  try {
    const events = await fetchTsdbSchedule()
    const db = createAdminClient()

    const { data: rawMatches } = await db
      .from('matches')
      .select(`
        id, external_id, fase, equipo_local_id, equipo_visitante_id,
        goles_local, goles_visitante, estado, advancer_team_id, kickoff_at,
        last_source, last_source_at,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)

    if (!rawMatches) throw new Error('No se pudo cargar matches de la BD')

    type OurMatchFull = OurMatch & {
      equipo_local: { nombre: string } | null
      equipo_visitante: { nombre: string } | null
    }

    const byTeamKey  = new Map<string, OurMatchFull>()
    const byExtId    = new Map<string, OurMatchFull>()

    for (const m of rawMatches as unknown as OurMatchFull[]) {
      if (m.external_id) byExtId.set(m.external_id, m)
      if (m.equipo_local && m.equipo_visitante) {
        // Clave order-independent: colisiona aunque local/visitante estén invertidos
        byTeamKey.set(teamPairKey(m.equipo_local.nombre, m.equipo_visitante.nombre), m)
      }
    }

    let anyNewlyFinished = false

    for (const ev of events) {
      // Buscar por external_id primero (más rápido tras primer sync)
      let our = byExtId.get(ev.idEvent)
      let needsIdSet = false

      if (!our) {
        // Primera vez: cruzar por par de equipos (sin importar el orden)
        our = byTeamKey.get(teamPairKey(tsdbTeamToDb(ev.strHomeTeam), tsdbTeamToDb(ev.strAwayTeam)))
        if (our) needsIdSet = true
      }

      if (!our) {
        result.notMapped++
        continue
      }

      result.mapped++

      if (isManualLocked(our)) continue

      const newEstado   = mapTsdbStatus(ev.strStatus)
      const isPostponed = ev.strPostponed === 'yes'
      const estadoFinal = isPostponed ? 'scheduled' : newEstado

      const homeScore = parseScore(ev.intHomeScore)
      const awayScore = parseScore(ev.intAwayScore)

      const wasFinished = our.estado === 'finished'
      const nowFinished = estadoFinal === 'finished'

      const update: Record<string, unknown> = {
        last_source:    'thesportsdb',
        last_source_at: new Date().toISOString(),
        estado:         estadoFinal,
      }

      // Orientar el marcador al orden local/visitante de NUESTRA BD (swap si invertido)
      const oriented = orientScores(
        tsdbTeamToDb(ev.strHomeTeam),
        our.equipo_local?.nombre ?? '',
        homeScore,
        awayScore,
      )

      if (needsIdSet)                        update['external_id']     = ev.idEvent
      if (ev.strTimestamp)                   update['kickoff_at']      = ev.strTimestamp
      if (oriented.goles_local !== null)     update['goles_local']     = oriented.goles_local
      if (oriented.goles_visitante !== null) update['goles_visitante'] = oriented.goles_visitante

      // Clasificado automático al finalizar eliminación: ganador en 90'/alargue →
      // directo del marcador; empate (penales) → intento vía evento completo en el
      // cierre; si no hay dato, lo define el admin a mano.
      if (nowFinished) {
        const adv = await resolveKnockoutAdvancer({
          fase: our.fase,
          orientedLocal: oriented.goles_local,
          orientedVisitante: oriented.goles_visitante,
          localId: our.equipo_local_id,
          visitanteId: our.equipo_visitante_id,
          currentAdvancer: our.advancer_team_id,
          freshFinish: !wasFinished,
          idEvent: our.external_id ?? ev.idEvent,
          ourHomeName: our.equipo_local?.nombre ?? '',
        })
        if (adv) update['advancer_team_id'] = adv
        update['minuto'] = null  // al finalizar no hay minuto (evita 123' fantasma)
      }

      const { error } = await db.from('matches').update(update).eq('id', our.id)
      if (error) {
        result.errors.push(`${our.id}: ${error.message}`)
      } else {
        result.updated++
        if (!wasFinished && nowFinished) {
          result.newlyFinished++
          anyNewlyFinished = true
        }
      }
    }

    // syncSchedule corre poco (1×/día + botón manual en /admin): reconciliar
    // siempre los clasificados oficiales hace de backfill de grupos ya cerrados.
    const qualifyChanged = await reconcileQualifiers(db, result)
    // Avanzar la llave oficial si terminó algún partido de eliminación
    if (anyNewlyFinished) {
      try { await advanceBracket(db) } catch (e) { result.errors.push(`advanceBracket: ${String(e)}`) }
    }
    if (anyNewlyFinished || qualifyChanged) triggerRecalc()

  } catch (err) {
    result.errors.push(String(err))
  }

  return result
}

// ─── Sync livescore (endpoint B) ──────────────────────────────────────────────

/**
 * Descarga el livescore del endpoint B y actualiza goles + minuto + estado.
 * Si livescore=[] devuelve {updated:0} sin error.
 * Solo actualiza partidos que ya tienen external_id mapeado.
 */
export async function syncLive(): Promise<SyncResult> {
  const result: SyncResult = { updated: 0, mapped: 0, notMapped: 0, newlyFinished: 0, errors: [] }

  try {
    const events = await fetchTsdbLive()
    if (events.length === 0) return result  // Normal: no hay partidos en vivo

    const db = createAdminClient()

    const { data: rawMatches } = await db
      .from('matches')
      .select(`
        id, external_id, fase, equipo_local_id, equipo_visitante_id,
        goles_local, goles_visitante, estado, advancer_team_id, kickoff_at,
        last_source, last_source_at,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .not('external_id', 'is', null)

    if (!rawMatches) return result

    type OurMatchLive = OurMatch & { equipo_local: { nombre: string } | null }

    const byExtId = new Map<string, OurMatchLive>(
      (rawMatches as unknown as OurMatchLive[]).map((m) => [m.external_id!, m])
    )

    let anyNewlyFinished = false

    for (const ev of events) {
      const our = byExtId.get(ev.idEvent)
      if (!our) { result.notMapped++; continue }

      result.mapped++
      if (isManualLocked(our)) continue

      const newEstado  = mapTsdbStatus(ev.strStatus)
      const homeScore  = parseScore(ev.intHomeScore)
      const awayScore  = parseScore(ev.intAwayScore)
      const minuto     = parseScore(ev.strProgress)

      const wasFinished = our.estado === 'finished'
      const nowFinished = newEstado === 'finished'

      const update: Record<string, unknown> = {
        last_source:    'thesportsdb',
        last_source_at: new Date().toISOString(),
        estado:         newEstado,
      }
      // Orientar marcador al orden local/visitante de nuestra BD (swap si invertido)
      const oriented = orientScores(
        tsdbTeamToDb(ev.strHomeTeam),
        our.equipo_local?.nombre ?? '',
        homeScore,
        awayScore,
      )
      if (oriented.goles_local !== null)     update['goles_local']     = oriented.goles_local
      if (oriented.goles_visitante !== null) update['goles_visitante'] = oriented.goles_visitante
      if (minuto !== null)                   update['minuto']          = minuto

      // Clasificado automático al finalizar eliminación: ganador en 90'/alargue →
      // directo del marcador; empate (penales) → intento vía evento completo.
      if (nowFinished) {
        const adv = await resolveKnockoutAdvancer({
          fase: our.fase,
          orientedLocal: oriented.goles_local,
          orientedVisitante: oriented.goles_visitante,
          localId: our.equipo_local_id,
          visitanteId: our.equipo_visitante_id,
          currentAdvancer: our.advancer_team_id,
          freshFinish: !wasFinished,
          idEvent: our.external_id ?? ev.idEvent,
          ourHomeName: our.equipo_local?.nombre ?? '',
        })
        if (adv) update['advancer_team_id'] = adv
        update['minuto'] = null  // al finalizar no hay minuto (evita 123' fantasma)
      }

      const { error } = await db.from('matches').update(update).eq('id', our.id)
      if (error) {
        result.errors.push(`${our.id}: ${error.message}`)
      } else {
        result.updated++
        if (!wasFinished && nowFinished) {
          result.newlyFinished++
          anyNewlyFinished = true
        }
      }
    }

    // syncLive corre cada minuto: solo reconciliar cuando algo recién finalizó.
    if (anyNewlyFinished) {
      await reconcileQualifiers(db, result)
      try { await advanceBracket(db) } catch (e) { result.errors.push(`advanceBracket: ${String(e)}`) }
      triggerRecalc()
    }

    // Backstop: partidos nuestros marcados 'live' que YA no aparecen en el feed de
    // livescore (TheSportsDB los saca al terminar). Si su kickoff fue hace 100 min–6 h
    // (ventana que evita falsos positivos por cortes momentáneos y no re-procesa datos
    // viejos), se finalizan vía syncSchedule (idempotente: marca finished, deriva el
    // clasificado, avanza la llave y recalcula). Sin esto quedan pegados EN VIVO hasta
    // el cron de schedule (3×/día).
    const liveIds = new Set(events.map((e) => e.idEvent))
    const now = Date.now()
    const droppedLive = (rawMatches as unknown as OurMatchLive[]).filter((m) => {
      if (m.estado !== 'live' || !m.external_id || liveIds.has(m.external_id)) return false
      if (!m.kickoff_at) return false
      const age = now - new Date(m.kickoff_at).getTime()
      return age > 100 * 60 * 1000 && age < 6 * 60 * 60 * 1000
    })
    if (droppedLive.length > 0) {
      const sched = await syncSchedule()
      result.errors.push(...sched.errors)
    }

  } catch (err) {
    result.errors.push(String(err))
  }

  return result
}
