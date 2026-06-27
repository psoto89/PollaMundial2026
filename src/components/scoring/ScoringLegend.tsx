/**
 * ScoringLegend
 * Desplegable de transparencia con las reglas exactas de puntaje.
 * Los valores reflejan src/lib/scoring.ts — mantener sincronizado si cambian.
 */

interface Rule {
  label: string
  pts: string
}

interface Section {
  titulo: string
  reglas: Rule[]
}

const SECTIONS: Section[] = [
  {
    titulo: 'Partidos (grupos y eliminación)',
    reglas: [
      { label: 'Aciertas el resultado (1/X/2)', pts: '+2' },
      { label: 'Aciertas el marcador exacto', pts: '+5' },
    ],
  },
  {
    titulo: 'Clasificados',
    reglas: [
      { label: 'Equipo clasificado (1º, 2º o mejor tercero)', pts: '+4' },
      { label: 'Además aciertas la posición exacta (1º/2º)', pts: '+4' },
    ],
  },
  {
    titulo: 'Puestos finales',
    reglas: [
      { label: 'Equipo entre los 4 semifinalistas', pts: '+10' },
      { label: 'Bonus campeón exacto', pts: '+20' },
      { label: 'Bonus subcampeón exacto', pts: '+15' },
      { label: 'Bonus 3er puesto exacto', pts: '+12' },
      { label: 'Bonus 4to puesto exacto', pts: '+10' },
    ],
  },
  {
    titulo: 'Preguntas',
    reglas: [{ label: 'Cada respuesta acertada', pts: '+7' }],
  },
]

export default function ScoringLegend() {
  return (
    <details className="group bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
      <summary className="flex items-center gap-3 py-3 px-4 cursor-pointer hover:bg-[#1c2128] transition-colors select-none list-none">
        <span className="text-sm font-semibold text-[#e6edf3]">¿Cómo se calculan los puntos?</span>
        <span className="text-xs text-[#768390] ml-auto group-open:rotate-90 transition-transform">▸</span>
      </summary>
      <div className="px-4 pb-4 pt-1 space-y-4 border-t border-[#21262d]">
        {SECTIONS.map((section) => (
          <div key={section.titulo}>
            <p className="text-xs font-semibold text-[#768390] uppercase tracking-wide mt-3 mb-1.5">
              {section.titulo}
            </p>
            <div className="space-y-1">
              {section.reglas.map((regla) => (
                <div key={regla.label} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 text-[#e6edf3]">{regla.label}</span>
                  <span className="font-mono font-bold text-[#9EE637] shrink-0">{regla.pts}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-[#768390] pt-2 border-t border-[#21262d]">
          Los puntos de <span className="text-[#9EE637] font-semibold">marcador exacto</span> ya incluyen
          los +2 del resultado. El bonus de posición/puesto se suma a los puntos por clasificar.
        </p>
      </div>
    </details>
  )
}
