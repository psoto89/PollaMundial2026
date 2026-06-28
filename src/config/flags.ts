/**
 * config/flags.ts
 *
 * Mapea cada equipo del Mundial 2026 (nombre en nuestra BD, en español) a su
 * código ISO-3166 alpha-2, para servir la bandera desde flagcdn.com como imagen
 * (crisp y consistente en cualquier dispositivo, a diferencia de los emoji).
 *
 * Los nombres canónicos salen de config/theSportsDbMap.ts (48 equipos validados).
 * Las claves del map están normalizadas (minúsculas, sin acentos) vía `normFlag`,
 * con variantes de escritura alternativas para tolerar diferencias del import.
 */

/** Normaliza un nombre de equipo: trim + minúsculas + sin acentos. */
function normFlag(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

// nombre normalizado → ISO2 (o subdivisión gb-eng / gb-sct para flagcdn)
const TEAM_ISO: Record<string, string> = {
  // Grupo A
  'mexico': 'mx',
  'sudafrica': 'za',
  'corea del sur': 'kr',
  'rep. checa': 'cz',
  'rep checa': 'cz',
  'republica checa': 'cz',
  // Grupo B
  'bosnia': 'ba',
  'canada': 'ca',
  'catar': 'qa',
  'qatar': 'qa',
  'suiza': 'ch',
  // Grupo C
  'brasil': 'br',
  'escocia': 'gb-sct',
  'haiti': 'ht',
  'marruecos': 'ma',
  // Grupo D
  'turquia': 'tr',
  // Grupo E
  'alemania': 'de',
  'costa de m': 'ci',
  'costa de marfil': 'ci',
  'curacao': 'cw',
  // Grupo F
  'japon': 'jp',
  'paises bajos': 'nl',
  'suecia': 'se',
  'tunez': 'tn',
  // Grupo G
  'belgica': 'be',
  'egipto': 'eg',
  'iran': 'ir',
  'n. zelanda': 'nz',
  'n zelanda': 'nz',
  'nueva zelanda': 'nz',
  // Grupo H
  'arabia': 'sa',
  'arabia saudita': 'sa',
  'cabo verde': 'cv',
  'espana': 'es',
  // Grupo I
  'francia': 'fr',
  'noruega': 'no',
  // Grupo J
  'jordania': 'jo',
  // Grupo K
  'congo': 'cd',
  'rd congo': 'cd',
  'uzbekistan': 'uz',
  // Grupo L
  'croacia': 'hr',
  'inglaterra': 'gb-eng',
  'panama': 'pa',
  // Iguales en BD/inglés (ver comentario en theSportsDbMap.ts)
  'algeria': 'dz',
  'argelia': 'dz',
  'argentina': 'ar',
  'australia': 'au',
  'austria': 'at',
  'colombia': 'co',
  'ecuador': 'ec',
  'ghana': 'gh',
  'iraq': 'iq',
  'irak': 'iq',
  'paraguay': 'py',
  'portugal': 'pt',
  'senegal': 'sn',
  'uruguay': 'uy',
  'usa': 'us',
  'estados unidos': 'us',
}

/** Código ISO2 (o subdivisión) del equipo, o null si no está mapeado. */
export function teamIso(teamNombre: string | null | undefined): string | null {
  if (!teamNombre) return null
  return TEAM_ISO[normFlag(teamNombre)] ?? null
}

/**
 * URL de la bandera del equipo desde flagcdn.com.
 * `w` = ancho del raster (flagcdn sirve w20, w40, w80, w160, w320…); por defecto 40.
 * Devuelve null si no hay equipo conocido (el render debe mostrar un fallback ⚽).
 */
export function flagUrl(teamNombre: string | null | undefined, w: 20 | 40 | 80 | 160 = 40): string | null {
  const iso = teamIso(teamNombre)
  return iso ? `https://flagcdn.com/w${w}/${iso}.png` : null
}
