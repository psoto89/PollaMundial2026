/**
 * lib/liveProvider.ts
 *
 * Interfaz desacoplada para la fuente de resultados en vivo.
 * Modo activo controlado por LIVE_PROVIDER:
 *
 *   LIVE_PROVIDER=thesportsdb (DEFAULT)
 *     Pull periódico desde TheSportsDB (schedule + livescore).
 *     Cron job en Vercel (60s en ventana de partido).
 *     Client-side fallback: LiveView hace POST /api/live/poll cada 60s.
 *
 *   LIVE_PROVIDER=manual
 *     Admin actualiza marcador + estado desde /admin/results.
 *     Escribir directo en Supabase → Realtime propaga.
 */
import type { LiveMatch } from '@/types'

export interface LiveProvider {
  getLiveMatches(): Promise<LiveMatch[]>
}

// ─── Provider TheSportsDB (default) ──────────────────────────────────────────

/**
 * thesportsdbProvider:
 * La escritura ocurre en los cron jobs (/api/cron/tsdb-live)
 * y en el client-side poll (/api/live/poll).
 * getLiveMatches() simplemente lee desde Supabase (Realtime hace el resto).
 */
export const thesportsdbProvider: LiveProvider = {
  async getLiveMatches(): Promise<LiveMatch[]> {
    return []
  },
}

// ─── Provider manual (fallback) ───────────────────────────────────────────────

/**
 * manualProvider:
 * Admin actualiza marcador + minuto + estado desde /admin/results.
 * matches.last_source = 'manual' protege de sobrescritura durante 30 min.
 */
export const manualProvider: LiveProvider = {
  async getLiveMatches(): Promise<LiveMatch[]> {
    return []
  },
}

// ─── Provider activo ──────────────────────────────────────────────────────────

const LIVE_PROVIDER_ENV = process.env.LIVE_PROVIDER ?? 'thesportsdb'

function selectProvider(): LiveProvider {
  switch (LIVE_PROVIDER_ENV) {
    case 'manual':       return manualProvider
    case 'thesportsdb':
    default:             return thesportsdbProvider
  }
}

export const activeProvider: LiveProvider = selectProvider()
