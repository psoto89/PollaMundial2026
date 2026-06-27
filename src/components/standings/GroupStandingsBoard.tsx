/**
 * GroupStandingsBoard
 * Tabla REAL de cada grupo (cómo van de verdad), calculada de forma determinista
 * con computeGroupStandings a partir de los marcadores ya jugados/en vivo.
 * Server component: recibe los datos que la home ya carga, sin queries extra.
 */
import {
  computeGroupStandings,
  computeBestThirds,
  type StandingMatch,
  type StandingTeam,
  type ThirdPlaceTeam,
} from '@/lib/standings'

interface GroupMatchInput {
  id: string
  grupo: string
  equipoLocalId: string
  equipoVisitanteId: string
  golesLocal: number | null
  golesVisitante: number | null
  estado: string
}

interface Props {
  groupMatches: GroupMatchInput[]
  teams: StandingTeam[]
}

export default function GroupStandingsBoard({ groupMatches, teams }: Props) {
  const grupos = [...new Set(teams.map((t) => t.grupo))].filter(Boolean).sort()
  if (grupos.length === 0) return null

  // Tabla por grupo + recolección de terceros para los "mejores terceros" provisionales.
  const thirds: ThirdPlaceTeam[] = []
  const perGroup = grupos.map((grupo) => {
    const groupTeams = teams.filter((t) => t.grupo === grupo)
    const standingMatches: StandingMatch[] = groupMatches
      .filter((m) => m.grupo === grupo && m.golesLocal !== null && m.golesVisitante !== null)
      .map((m) => ({
        equipoLocalId: m.equipoLocalId,
        equipoVisitanteId: m.equipoVisitanteId,
        golesLocal: m.golesLocal as number,
        golesVisitante: m.golesVisitante as number,
      }))
    const isLive = groupMatches.some((m) => m.grupo === grupo && m.estado === 'live')
    const { rows } = computeGroupStandings(standingMatches, groupTeams)
    const tercero = rows.find((r) => r.posicion === 3)
    if (tercero) {
      thirds.push({
        teamId: tercero.teamId,
        teamNombre: tercero.teamNombre,
        grupo,
        pts: tercero.pts,
        gd: tercero.gd,
        gf: tercero.gf,
      })
    }
    return { grupo, rows, isLive, jugados: standingMatches.length }
  })

  // Mejores terceros provisionales (8 de 12) → para marcar cuáles 3º van clasificando.
  const bestThirds = computeBestThirds(thirds)
  const bestThirdIds = new Set(bestThirds.qualified.map((t) => t.teamId))

  const anyPlayed = perGroup.some((g) => g.jugados > 0)

  return (
    <details className="group bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      <summary className="flex items-center gap-3 py-3 px-4 cursor-pointer hover:bg-[#1c2128] transition-colors select-none list-none">
        <span className="text-sm font-semibold text-[#e6edf3]">Cómo van los grupos (real)</span>
        <span className="text-xs text-[#768390] ml-auto group-open:rotate-90 transition-transform">▸</span>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-[#21262d]">
        {!anyPlayed ? (
          <p className="text-xs text-[#768390] py-3">Aún no hay partidos jugados.</p>
        ) : (
          <>
            <p className="text-xs text-[#768390] py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><span className="text-[#9EE637] font-semibold">1º / 2º</span> clasifican</span>
              <span><span className="text-[#9EE637] font-semibold">3º ↗</span> mejor tercero (provisional)</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {perGroup.map(({ grupo, rows, isLive }) => (
                <div key={grupo} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#768390]">Grupo {grupo}</span>
                    {isLive && (
                      <span className="text-[10px] font-semibold bg-[#f85149]/15 text-[#f85149] px-1.5 py-0.5 rounded animate-pulse">
                        en vivo
                      </span>
                    )}
                  </div>
                  {/* Encabezado de columnas */}
                  <div className="flex items-center gap-2 text-[10px] text-[#444d56] mb-1 px-0.5">
                    <span className="w-7 shrink-0">Pos</span>
                    <span className="flex-1">Equipo</span>
                    <span className="w-6 text-right shrink-0">PJ</span>
                    <span className="w-8 text-right shrink-0">DG</span>
                    <span className="w-8 text-right shrink-0">Pts</span>
                  </div>
                  <div className="space-y-1">
                    {rows.map((row) => {
                      const clasifica = row.posicion === 1 || row.posicion === 2
                      const esBestThird = row.posicion === 3 && bestThirdIds.has(row.teamId)
                      const posLabel =
                        row.posicion === null
                          ? '–'
                          : row.posicion === 3
                            ? '3° ↗'
                            : `${row.posicion}°`
                      const highlight = clasifica || esBestThird
                      return (
                        <div key={row.teamId} className="flex items-center gap-2 text-xs">
                          <span className={`w-7 shrink-0 ${highlight ? 'text-[#9EE637]' : 'text-[#768390]'}`}>
                            {posLabel}
                          </span>
                          <span className={`flex-1 truncate ${highlight ? 'text-[#e6edf3]' : 'text-[#768390]'}`}>
                            {row.teamNombre}
                          </span>
                          <span className="w-6 text-right shrink-0 text-[#768390] tabular-nums">{row.pj}</span>
                          <span className="w-8 text-right shrink-0 text-[#768390] tabular-nums">
                            {row.gd > 0 ? `+${row.gd}` : row.gd}
                          </span>
                          <span className={`w-8 text-right shrink-0 font-bold tabular-nums ${highlight ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
                            {row.pts}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  )
}
