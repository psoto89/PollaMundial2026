/**
 * lib/liveProvider.ts
 *
 * Interfaz desacoplada para la fuente de resultados en vivo.
 * Tres modos controlados por la variable de entorno LIVE_PROVIDER:
 *
 *   LIVE_PROVIDER=webhook (DEFAULT en producción)
 *     BallDontLie hace POST a /api/webhooks/live cuando ocurre un evento.
 *     El endpoint escribe en Supabase → Realtime propaga a clientes.
 *     Este provider es PASIVO: su getLiveMatches() solo lee la BD.
 *
 *   LIVE_PROVIDER=manual (FALLBACK siempre disponible)
 *     Admin actualiza marcador + estado desde /admin/results.
 *     Misma mecánica: escribe en Supabase → Realtime.
 *     Usar cuando BallDontLie no envía eventos o hay conflicto.
 *
 *   LIVE_PROVIDER=poll (reconciliador, OFF por defecto)
 *     Pull cada 2–3 min contra una API REST mientras hay partidos live.
 *     Útil si se perdieron webhooks (Vercel caído en ese instante).
 *     Activar también con RECONCILE_LIVE=true (cualquier modo base).
 *     Requiere FOOTBALL_API_KEY cuando se implemente.
 */
import type { LiveMatch } from '@/types'

export interface LiveProvider {
  /** Obtiene partidos en vivo desde la BD. */
  getLiveMatches(): Promise<LiveMatch[]>
}

// ─── Provider webhook (default en producción) ─────────────────────────────────

/**
 * webhookProvider:
 * La fuente de verdad son los eventos de BallDontLie → /api/webhooks/live.
 * getLiveMatches() simplemente lee la BD (igual que manual).
 * Este provider es PASIVO — la escritura ocurre en el endpoint webhook.
 */
export const webhookProvider: LiveProvider = {
  async getLiveMatches(): Promise<LiveMatch[]> {
    // Lectura desde Supabase via el componente server o client component.
    // El endpoint webhook ya escribió; aquí solo declaramos la intención.
    return []
  },
}

// ─── Provider manual (fallback) ───────────────────────────────────────────────

/**
 * manualProvider:
 * Admin actualiza marcador + minuto + estado desde /admin/results.
 * matches.last_source se setea a 'manual' → protege de sobrescritura por webhook
 * durante MANUAL_LOCK_MINUTES minutos.
 */
export const manualProvider: LiveProvider = {
  async getLiveMatches(): Promise<LiveMatch[]> {
    // No hace pull: el admin escribe directo en Supabase.
    return []
  },
}

// ─── Provider poll / reconciliador (OFF por defecto) ──────────────────────────

/**
 * pollProvider:
 * Reconciliador de respaldo: hace pull ligero cada 2–3 min SOLO mientras hay
 * partidos en estado 'live'. Se activa con LIVE_PROVIDER=poll o RECONCILE_LIVE=true.
 *
 * Actualmente es un placeholder. Para implementar con API-Football:
 *   1. Setear FOOTBALL_API_KEY en .env.local
 *   2. Implementar la función fetchLiveFromApi() abajo
 *   3. Activar con LIVE_PROVIDER=poll
 *
 * El pollProvider escribe en Supabase igual que el webhook (con last_source='poll').
 * El manual lock también aplica aquí (no pisa updates manuales recientes).
 */
export const pollProvider: LiveProvider = {
  async getLiveMatches(): Promise<LiveMatch[]> {
    // TODO: implementar cuando se necesite reconciliación.
    // Requiere FOOTBALL_API_KEY y mapeo de IDs externos.
    //
    // Ejemplo de implementación futura:
    // const res = await fetch('https://v3.football.api-sports.io/fixtures?live=all', {
    //   headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY! },
    // })
    // const data = await res.json()
    // return data.response.map(mapApiFixtureToLiveMatch)
    console.warn('[pollProvider] No implementado. Usar LIVE_PROVIDER=webhook o manual.')
    return []
  },
}

// ─── Provider activo según env var ────────────────────────────────────────────

const LIVE_PROVIDER_ENV = process.env.LIVE_PROVIDER ?? 'webhook'

function selectProvider(): LiveProvider {
  switch (LIVE_PROVIDER_ENV) {
    case 'manual':  return manualProvider
    case 'poll':    return pollProvider
    case 'webhook':
    default:        return webhookProvider
  }
}

export const activeProvider: LiveProvider = selectProvider()
