/**
 * lib/excelParser.ts
 * Parser multi-hoja para Gran_Polla_Mundial_2026.xlsx
 * Lee pronósticos, deriva equipos y partidos, normaliza nombres de equipo.
 * Todo el mapeo de coordenadas viene de config/excelMap.ts.
 */
import * as XLSX from 'xlsx'
import {
  IGNORE_SHEETS,
  GROUP_COLS,
  GROUPS,
  MATCH_ROW_PAIRS,
  QUALIFY_ROWS,
  SEMIS_CELLS,
  QUESTION_CELLS,
  PRIZE_CELLS,
  normalizeTeam,
} from '@/config/excelMap'
import type {
  ParsedExcel,
  ParsedParticipant,
  ParsedTeam,
  ParsedMatch,
  ParsedPredictionGroup,
  ParsedPredictionQualify,
  ParsedPredictionSemis,
  ParsedPredictionQuestion,
  Puesto,
  PreguntaKey,
} from '@/types'

// ─── Utilidades internas ──────────────────────────────────────────────────────

function colToIndex(col: string): number {
  // Convierte 'A'→1, 'Z'→26, 'AA'→27, 'AV'→48
  let n = 0
  for (const c of col.toUpperCase()) {
    n = n * 26 + (c.charCodeAt(0) - 64)
  }
  return n
}

function cellValue(ws: XLSX.WorkSheet, col: string, row: number): unknown {
  const cell = ws[XLSX.utils.encode_cell({ r: row - 1, c: colToIndex(col) - 1 })]
  return cell ? cell.v : null
}

function cellStr(ws: XLSX.WorkSheet, col: string, row: number): string | null {
  const v = cellValue(ws, col, row)
  if (v === null || v === undefined) return null
  return String(v).trim() || null
}

function cellNum(ws: XLSX.WorkSheet, col: string, row: number): number | null {
  const v = cellValue(ws, col, row)
  if (v === null || v === undefined) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

/** Parsea una celda de referencia tipo 'C74' en {col, row} */
function parseRef(ref: string): { col: string; row: number } {
  const m = ref.match(/^([A-Za-z]+)(\d+)$/)
  if (!m) throw new Error(`Referencia inválida: ${ref}`)
  return { col: m[1].toUpperCase(), row: parseInt(m[2], 10) }
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseExcel(buffer: ArrayBuffer): ParsedExcel {
  const wb = XLSX.read(buffer, { type: 'array' })
  const participantSheets = wb.SheetNames.filter(
    (name) => !IGNORE_SHEETS.includes(name),
  )

  const participants: ParsedParticipant[] = []
  const teamSet = new Map<string, ParsedTeam>() // nombre normalizado → team
  const matchMap = new Map<string, ParsedMatch>() // `${grupo}:${matchIdx}` → match

  // Índice global de partidos: 0–71 (12 grupos × 6 partidos)
  let matchIndex = 0

  // Primera hoja como referencia para derivar equipos y partidos
  const refSheet = wb.Sheets[participantSheets[0]]
  deriveFixtures(refSheet, teamSet, matchMap)

  for (const sheetName of participantSheets) {
    const ws = wb.Sheets[sheetName]
    const participant = parseParticipantSheet(ws, sheetName, matchMap)
    participants.push(participant)
  }

  // Leer PREMIACIÓN
  const premSheet = wb.Sheets['PREMIACIÓN']
  const prizePool = {
    pctPrimero: cellNum(premSheet, parseRef(PRIZE_CELLS.primero).col, parseRef(PRIZE_CELLS.primero).row) ?? 0.6,
    pctSegundo: cellNum(premSheet, parseRef(PRIZE_CELLS.segundo).col, parseRef(PRIZE_CELLS.segundo).row) ?? 0.3,
    pctGrupos:  cellNum(premSheet, parseRef(PRIZE_CELLS.grupos).col,  parseRef(PRIZE_CELLS.grupos).row)  ?? 0.1,
  }

  return {
    participants,
    teams: Array.from(teamSet.values()),
    matches: Array.from(matchMap.values()),
    prizePool,
  }
}

// ─── Derivar catálogo de equipos y partidos desde una hoja de referencia ─────

function deriveFixtures(
  ws: XLSX.WorkSheet,
  teamSet: Map<string, ParsedTeam>,
  matchMap: Map<string, ParsedMatch>,
): void {
  let globalMatchIndex = 0

  for (const grupo of GROUPS) {
    const { team: teamCol } = GROUP_COLS[grupo]

    MATCH_ROW_PAIRS.forEach(([localRow, visitanteRow]) => {
      const localTeamRaw = cellStr(ws, teamCol, localRow)
      const visitanteTeamRaw = cellStr(ws, teamCol, visitanteRow)
      const localTeam = normalizeTeam(localTeamRaw)
      const visitanteTeam = normalizeTeam(visitanteTeamRaw)

      // Registrar equipos
      if (localTeam && !teamSet.has(localTeam)) {
        teamSet.set(localTeam, { nombre: localTeam, grupo })
      }
      if (visitanteTeam && !teamSet.has(visitanteTeam)) {
        teamSet.set(visitanteTeam, { nombre: visitanteTeam, grupo })
      }

      // Registrar partido
      const key = `${grupo}:${globalMatchIndex}`
      matchMap.set(key, {
        matchIndex: globalMatchIndex,
        grupo,
        localTeam: localTeam || `Equipo-${globalMatchIndex}-local`,
        visitanteTeam: visitanteTeam || `Equipo-${globalMatchIndex}-visitante`,
      })

      globalMatchIndex++
    })
  }
}

// ─── Parsear una hoja de participante ────────────────────────────────────────

function parseParticipantSheet(
  ws: XLSX.WorkSheet,
  sheetAlias: string,
  matchMap: Map<string, ParsedMatch>,
): ParsedParticipant {
  // Nombre real del participante (celda F2)
  const nombre = cellStr(ws, 'F', 2) ?? sheetAlias

  // Pronósticos de partidos de grupo
  const predictionsGroup: ParsedPredictionGroup[] = []
  let globalMatchIndex = 0

  for (const grupo of GROUPS) {
    const { team: teamCol, score: scoreCol } = GROUP_COLS[grupo]

    MATCH_ROW_PAIRS.forEach(([localRow, visitanteRow]) => {
      const localTeamRaw = cellStr(ws, teamCol, localRow)
      const visitanteTeamRaw = cellStr(ws, teamCol, visitanteRow)
      const predLocal = cellNum(ws, scoreCol, localRow)
      const predVisitante = cellNum(ws, scoreCol, visitanteRow)

      predictionsGroup.push({
        matchIndex: globalMatchIndex,
        grupo,
        localTeam: normalizeTeam(localTeamRaw),
        visitanteTeam: normalizeTeam(visitanteTeamRaw),
        predLocal,
        predVisitante,
      })

      globalMatchIndex++
    })
  }

  // Pronósticos de clasificados (filas 42, 43, 44)
  const predictionsQualify: ParsedPredictionQualify[] = []
  for (const grupo of GROUPS) {
    const { team: teamCol } = GROUP_COLS[grupo]
    for (const [posStr, row] of Object.entries(QUALIFY_ROWS)) {
      const posicion = parseInt(posStr, 10) as 1 | 2 | 3
      const teamRaw = cellStr(ws, teamCol, row)
      const team = normalizeTeam(teamRaw)
      if (team) {
        predictionsQualify.push({ grupo, posicion, team })
      }
    }
  }

  // Pronósticos de semis / puestos finales
  const predictionsSemis: ParsedPredictionSemis[] = []
  for (const [puesto, cellRef] of Object.entries(SEMIS_CELLS)) {
    const { col, row } = parseRef(cellRef)
    const teamRaw = cellStr(ws, col, row)
    const team = normalizeTeam(teamRaw)
    if (team) {
      predictionsSemis.push({ puesto: puesto as Puesto, team })
    }
  }

  // Preguntas (6)
  const predictionsQuestions: ParsedPredictionQuestion[] = []
  for (const [key, cellRef] of Object.entries(QUESTION_CELLS)) {
    const { col, row } = parseRef(cellRef)
    const v = cellValue(ws, col, row)
    let respuesta: string | number | null = null
    if (v !== null && v !== undefined) {
      respuesta = typeof v === 'number' ? v : String(v).trim()
    }
    predictionsQuestions.push({ key: key as PreguntaKey, respuesta })
  }

  return {
    sheetAlias,
    nombre,
    predictionsGroup,
    predictionsQualify,
    predictionsSemis,
    predictionsQuestions,
  }
}
