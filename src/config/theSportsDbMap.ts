/**
 * config/theSportsDbMap.ts
 *
 * Mapeo TheSportsDB → nuestra BD para el Mundial 2026.
 * Fuente: GET /api/v2/json/schedule/league/4429/2026 (validado con datos reales).
 * idLeague = 4429 (env WORLDCUP_LEAGUE_ID)
 */
import { normalizeTeam } from '@/config/excelMap'

// ─── Status mapping ───────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, 'scheduled' | 'live' | 'finished'> = {
  NS:              'scheduled',
  '1H':            'live',
  '2H':            'live',
  HT:              'live',
  ET:              'live',
  ET1:             'live',
  ET2:             'live',
  P:               'live',
  PEN:             'live',
  LIVE:            'live',
  FT:              'finished',
  AET:             'finished',
  'Match Finished':'finished',
}

export function mapTsdbStatus(strStatus: string): 'scheduled' | 'live' | 'finished' {
  const known = STATUS_MAP[strStatus]
  if (known) return known
  // Valor no reconocido que no es NS/FT → tratar como live y loguear
  if (strStatus !== 'NS' && strStatus !== 'FT') {
    console.warn(`[tsdb] strStatus desconocido: "${strStatus}" → 'live'`)
    return 'live'
  }
  return 'scheduled'
}

// ─── Diccionario de equipos: TheSportsDB (inglés) → nuestra BD (español) ─────
// Validado contra el schedule real: 72 partidos, 48 equipos.
// "Costa De M" es el nombre exacto en la BD (truncado desde el Excel).

const TEAM_MAP: Record<string, string> = {
  // Grupo A
  'Mexico':              'México',
  'South Africa':        'Sudáfrica',
  'South Korea':         'Corea del Sur',
  'Czech Republic':      'Rep. Checa',
  // Grupo B
  'Bosnia-Herzegovina':  'Bosnia',
  'Canada':              'Canadá',
  'Qatar':               'Catar',
  'Switzerland':         'Suiza',
  // Grupo C
  'Brazil':              'Brasil',
  'Scotland':            'Escocia',
  'Haiti':               'Haití',
  'Morocco':             'Marruecos',
  // Grupo D
  'Turkey':              'Turquía',
  // Grupo E
  'Germany':             'Alemania',
  'Ivory Coast':         'Costa De M',
  'Curaçao':             'Curacao',
  // Grupo F
  'Japan':               'Japón',
  'Netherlands':         'Países Bajos',
  'Sweden':              'Suecia',
  'Tunisia':             'Tunez',
  // Grupo G
  'Belgium':             'Bélgica',
  'Egypt':               'Egipto',
  'Iran':                'Irán',
  'New Zealand':         'N. Zelanda',
  // Grupo H
  'Saudi Arabia':        'Arabia',
  'Cape Verde':          'Cabo Verde',
  'Spain':               'España',
  // Grupo I
  'France':              'Francia',
  'Norway':              'Noruega',
  // Grupo J
  'Jordan':              'Jordania',
  // Grupo K
  'DR Congo':            'Congo',
  'Uzbekistan':          'Uzbekistán',
  // Grupo L
  'Croatia':             'Croacia',
  'England':             'Inglaterra',
  'Panama':              'Panamá',
}

/**
 * Convierte el nombre inglés de TheSportsDB al nombre en español de nuestra BD.
 * Si no hay mapeo, devuelve el nombre tal cual (equipos que son iguales en ambos:
 * Algeria, Argentina, Australia, Austria, Colombia, Ecuador, Ghana, Iraq,
 * Paraguay, Portugal, Senegal, Uruguay, USA).
 */
export function tsdbTeamToDb(englishName: string): string {
  return TEAM_MAP[englishName] ?? englishName
}

// ─── Cruce de partidos order-independent ─────────────────────────────────────
// El Excel y TheSportsDB no siempre coinciden en quién es local/visitante
// (p.ej. BD: "Suiza vs Catar" pero TheSportsDB: "Qatar vs Switzerland").
// La clave usa el par ORDENADO para que ambos lados colisionen sin importar el orden.

/** Clave de par de equipos independiente del orden local/visitante. */
export function teamPairKey(a: string, b: string): string {
  return [normalizeTeam(a), normalizeTeam(b)].sort().join('__')
}

/**
 * Orienta el marcador de TheSportsDB al orden local/visitante de NUESTRA BD.
 * Si el local de TheSportsDB es el mismo que nuestro local → directo.
 * Si está invertido → swap de goles. Así nunca guardamos el marcador al revés.
 *
 * @param tsdbHomeDbName  nombre del local de TheSportsDB ya convertido a ES (tsdbTeamToDb)
 * @param ourHomeName     nombre de nuestro equipo local en la BD
 */
export function orientScores(
  tsdbHomeDbName: string,
  ourHomeName: string,
  homeScore: number | null,
  awayScore: number | null,
): { goles_local: number | null; goles_visitante: number | null } {
  const sameOrientation = normalizeTeam(tsdbHomeDbName) === normalizeTeam(ourHomeName)
  return sameOrientation
    ? { goles_local: homeScore, goles_visitante: awayScore }
    : { goles_local: awayScore, goles_visitante: homeScore }
}
