import Link from 'next/link'

export const metadata = {
  title: 'Reglas — Polla Mundial 2026',
}

export default function ReglasPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
        <h1 className="text-2xl font-bold text-[#e6edf3]">Reglas de puntaje</h1>
        <p className="text-sm text-[#768390] mt-1">Gran Polla Mundial 2026</p>
      </div>

      {/* 1. Partidos de grupos */}
      <Section
        num="1"
        title="Partidos de fase de grupos"
        subtitle="72 partidos · 6 por grupo"
      >
        <RuleRow
          label="Acertar el signo (quién gana o si empata)"
          pts="+2 pts"
          color="green"
        />
        <RuleRow
          label="Marcador exacto (incluye acertar el signo)"
          pts="+5 pts"
          color="blue"
          detail="2 de signo + 3 de exacto"
        />
        <div className="mt-3 p-3 bg-[#1c2128] rounded-lg text-xs text-[#768390]">
          <strong className="text-[#e6edf3]">Ejemplo:</strong> El partido termina 2–1. Si pronosticaste 1–0 aciertas el signo (+2). Si pronosticaste 2–1 aciertas todo (+5).
        </div>
      </Section>

      {/* 2. Clasificados */}
      <Section
        num="2"
        title="Clasificados a dieciseisavos"
        subtitle="3 picks por grupo · 12 grupos"
      >
        <RuleRow
          label="Equipo que clasifica (1°, 2° del grupo o mejor tercero)"
          pts="+4 pts"
          color="green"
        />
        <RuleRow
          label="Posición exacta en el grupo (1° o 2°)"
          pts="+4 pts"
          color="blue"
          detail="adicional al punto anterior"
        />
        <div className="mt-3 p-3 bg-[#1c2128] rounded-lg text-xs text-[#768390]">
          <strong className="text-[#e6edf3]">Nota:</strong> Los 8 mejores terceros de cada grupo también clasifican. Si apostaste un equipo en posición 3 y efectivamente queda como mejor tercero, ganas +4 pts (sin bonus de posición exacta).
        </div>
      </Section>

      {/* 3. Semifinales */}
      <Section
        num="3"
        title="Semifinales / Puestos finales"
        subtitle="4 picks: Campeón · Subcampeón · 3° · 4°"
      >
        <RuleRow
          label="Equipo entre los 4 semifinalistas"
          pts="+10 pts"
          color="green"
          detail="por cada pick acertado"
        />
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold text-[#768390] uppercase tracking-wider mb-2">Bonus por puesto exacto</p>
          {[
            { puesto: '🥇 Campeón exacto', pts: '+20 pts' },
            { puesto: '🥈 Subcampeón exacto', pts: '+15 pts' },
            { puesto: '🥉 3er puesto exacto', pts: '+12 pts' },
            { puesto: '4to puesto exacto', pts: '+10 pts' },
          ].map(({ puesto, pts }) => (
            <div key={puesto} className="flex items-center justify-between py-2 px-3 bg-[#1c2128] rounded-lg">
              <span className="text-sm text-[#e6edf3]">{puesto}</span>
              <span className="text-sm font-bold text-[#58a6ff]">{pts}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 bg-[#1c2128] rounded-lg text-xs text-[#768390]">
          <strong className="text-[#e6edf3]">Ejemplo:</strong> Apostaste a España como Campeón. Si España llega a semifinales: +10. Si además gana el torneo: +10+20 = +30 pts.
        </div>
      </Section>

      {/* 4. Preguntas */}
      <Section
        num="4"
        title="Preguntas"
        subtitle="6 preguntas · +7 puntos cada una"
      >
        {[
          '¿Quién marcará el primer gol del Mundial?',
          '¿Quién será el goleador del Mundial?',
          '¿Cuántos goles marcará el goleador?',
          '¿Quién será el máximo asistidor?',
          '¿Cuál será el equipo con más goles?',
          '¿Cuántos goles se marcarán en la Final?',
        ].map((q, i) => (
          <div key={i} className="flex items-start gap-3 py-2 border-b border-[#21262d] last:border-0">
            <span className="text-xs text-[#768390] w-6 shrink-0 mt-0.5">{i + 1}.</span>
            <span className="text-sm text-[#e6edf3] flex-1">{q}</span>
            <span className="text-sm font-bold text-[#9EE637] shrink-0">+7</span>
          </div>
        ))}
      </Section>

      {/* 5. Polla 2 · Cuadro eliminatorio */}
      <Section
        num="5"
        title="Polla 2 · Cuadro eliminatorio"
        subtitle="Arma tu bracket: marcador de 90′ + quién avanza, de 16avos a la Final"
      >
        <p className="text-xs font-semibold text-[#768390] uppercase tracking-wider mb-1">Por partido</p>
        <RuleRow
          label="Marcador exacto de 90′ + reposición (no cuenta tiempo extra ni penales)"
          pts="+5 pts"
          color="blue"
          detail="ya incluye acertar el signo"
        />
        <RuleRow
          label="Solo el signo de 90′ (gana o empata)"
          pts="+2 pts"
          color="green"
        />
        <RuleRow
          label="Aciertas el equipo que clasifica (tras tiempo extra/penales)"
          pts="+2 pts"
          color="green"
          detail="independiente del marcador · máximo 7 por partido"
        />
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold text-[#768390] uppercase tracking-wider mb-2">Bonos del cuadro</p>
          {[
            { puesto: 'Cada clasificado a 8vos (máx 16)', pts: '+1 pt' },
            { puesto: 'Cada clasificado a cuartos (máx 16)', pts: '+2 pts' },
            { puesto: 'Cada semifinalista (máx 20)', pts: '+5 pts' },
            { puesto: '🥇 Campeón', pts: '+25 pts' },
            { puesto: '🥈 Subcampeón', pts: '+15 pts' },
            { puesto: '🥉 Tercer puesto', pts: '+10 pts' },
          ].map(({ puesto, pts }) => (
            <div key={puesto} className="flex items-center justify-between py-2 px-3 bg-[#1c2128] rounded-lg">
              <span className="text-sm text-[#e6edf3]">{puesto}</span>
              <span className="text-sm font-bold text-[#58a6ff]">{pts}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 bg-[#1c2128] rounded-lg text-xs text-[#768390]">
          <strong className="text-[#e6edf3]">Cierre:</strong> cada partido se puede editar hasta unos minutos
          antes de su inicio (hora de Colombia). Los partidos ya jugados al activar la polla no participan.
        </div>
      </Section>

      {/* Resumen de puntos máximos */}
      <div className="bg-[#161b22] border border-[#9EE637]/20 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#e6edf3] mb-3">Puntos máximos posibles</h3>
        <p className="text-xs text-[#768390] mb-2">Polla 1 (grupos + clasificados + puestos + preguntas)</p>
        <div className="space-y-1.5">
          {[
            { cat: '1. Partidos de grupos (72 × 5)', max: '360 pts' },
            { cat: '2. Clasificados (36 picks × 8)', max: '288 pts' },
            { cat: '3. Semifinales (4 picks × 40 max)', max: '160 pts' },
            { cat: '4. Preguntas (6 × 7)', max: '42 pts' },
          ].map(({ cat, max }) => (
            <div key={cat} className="flex items-center justify-between text-sm">
              <span className="text-[#768390]">{cat}</span>
              <span className="font-bold text-[#e6edf3] tabular-nums">{max}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm font-bold border-t border-[#30363d] pt-2 mt-2">
            <span className="text-[#e6edf3]">TOTAL POLLA 1</span>
            <span className="text-[#9EE637] text-base">850 pts</span>
          </div>
        </div>

        <p className="text-xs text-[#768390] mb-2 mt-5">Polla 2 (cuadro eliminatorio)</p>
        <div className="space-y-1.5">
          {[
            { cat: 'Partidos (32 × 7)', max: '224 pts' },
            { cat: 'Bonos de cuadro (16+16+20+25+15+10)', max: '102 pts' },
          ].map(({ cat, max }) => (
            <div key={cat} className="flex items-center justify-between text-sm">
              <span className="text-[#768390]">{cat}</span>
              <span className="font-bold text-[#e6edf3] tabular-nums">{max}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm font-bold border-t border-[#30363d] pt-2 mt-2">
            <span className="text-[#e6edf3]">TOTAL POLLA 2</span>
            <span className="text-[#9EE637] text-base">326 pts</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Componentes internos ─────────────────────────────────────

function Section({
  num, title, subtitle, children,
}: {
  num: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-bold text-[#9EE637] bg-[#9EE637]/10 rounded px-1.5 py-0.5">
            {num}
          </span>
          <h2 className="text-base font-semibold text-[#e6edf3]">{title}</h2>
        </div>
        <p className="text-xs text-[#768390]">{subtitle}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function RuleRow({
  label, pts, color, detail,
}: {
  label: string
  pts: string
  color: 'green' | 'blue'
  detail?: string
}) {
  const ptColor = color === 'green' ? 'text-[#9EE637]' : 'text-[#58a6ff]'
  return (
    <div className="flex items-start gap-3 py-2 px-3 bg-[#1c2128] rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e6edf3]">{label}</p>
        {detail && <p className="text-xs text-[#768390] mt-0.5">{detail}</p>}
      </div>
      <span className={`text-sm font-bold shrink-0 tabular-nums ${ptColor}`}>{pts}</span>
    </div>
  )
}
