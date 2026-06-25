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
import { mapTsdbStatus, tsdbTeamToDb, teamPairKey, orientScores } from '@/config/theSportsDbMap'
import { syncQualifyFromResults } from '@/lib/autoQualify'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parsea score string a int. "" o null → null */
function parseScore(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null
  const n = parseInt(s, 10)
  return isNaN(n) ? null : n
}

type OurMatch = {
  id:              string
  external_id:     string | null
  goles_local:     number | null
  goles_visitante: number | null
  estado:          string
  last_source:     string | null
  last_source_at:  string | null
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
        id, external_id, goles_local, goles_visitante, estado, last_source, last_source_at,
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
        id, external_id, goles_local, goles_visitante, estado, last_source, last_source_at,
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
      triggerRecalc()
    }

  } catch (err) {
    result.errors.push(String(err))
  }

  return result
}
