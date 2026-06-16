import { createClient } from '@/lib/supabase/server'

export const revalidate = 60

// Cada participante apuesta este valor (COP). El pozo total = N × esto.
const APUESTA_POR_PARTICIPANTE = 100_000

interface ScoreRow {
  total: number
  total_grupos: number
  participants: { nombre: string } | null
}

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

export default async function PremiacionPage() {
  const supabase = await createClient()

  const { data: prize } = await supabase
    .from('prize_pool')
    .select('*')
    .limit(1)
    .single()

  const { data: scoresRaw } = await supabase
    .from('scores_cache')
    .select('total, total_grupos, participants(nombre)')
    .order('total', { ascending: false })

  const scores = (scoresRaw ?? []) as unknown as ScoreRow[]

  // Pozo total = #participantes × apuesta
  const numParticipantes = scores.length
  const pozoTotal = numParticipantes * APUESTA_POR_PARTICIPANTE

  // Quién va ganando cada bolsa
  const primero = scores[0] ?? null
  const segundo = scores[1] ?? null
  const grupoLeader = [...scores].sort((a, b) => b.total_grupos - a.total_grupos)[0] ?? null

  if (!prize) {
    return (
      <div className="space-y-8">
        <h1 className="text-2xl font-bold text-[#e6edf3]">🏆 Premiación</h1>
        <div className="text-center py-16 text-[#768390]">
          <p>Sin datos de premiación. Importa el Excel primero.</p>
        </div>
      </div>
    )
  }

  const pctPrimero = Number(prize.pct_primero)
  const pctSegundo = Number(prize.pct_segundo)
  const pctGrupos = Number(prize.pct_grupos)

  const premios = [
    {
      label: '🥇 1er puesto',
      color: '#ffa657',
      pct: pctPrimero,
      monto: pozoTotal * pctPrimero,
      lider: primero ? { nombre: primero.participants?.nombre, detalle: `${primero.total} pts` } : null,
    },
    {
      label: '🥈 2do puesto',
      color: '#c9d1d9',
      pct: pctSegundo,
      monto: pozoTotal * pctSegundo,
      lider: segundo ? { nombre: segundo.participants?.nombre, detalle: `${segundo.total} pts` } : null,
    },
    {
      label: '⚽ Fase de grupos',
      color: '#9EE637',
      pct: pctGrupos,
      monto: pozoTotal * pctGrupos,
      lider: grupoLeader ? { nombre: grupoLeader.participants?.nombre, detalle: `${grupoLeader.total_grupos} pts grupos` } : null,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#e6edf3]">🏆 Premiación</h1>
        <p className="text-sm text-[#768390] mt-1">Reparto del pozo entre los participantes</p>
      </div>

      {/* Pozo total */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 text-center">
        <div className="text-xs font-semibold text-[#768390] uppercase tracking-widest">Pozo total</div>
        <div className="text-4xl font-black text-[#9EE637] tabular-nums mt-1">{cop(pozoTotal)}</div>
        <div className="text-xs text-[#768390] mt-1">
          {numParticipantes} participantes × {cop(APUESTA_POR_PARTICIPANTE)}
        </div>
      </div>

      {/* Premios con valor */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {premios.map((p, idx) => (
          <div key={idx} className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-center">
            <div className="text-xs text-[#768390]">{p.label}</div>
            <div className="text-2xl font-black tabular-nums mt-2" style={{ color: p.color }}>
              {cop(p.monto)}
            </div>
            <div className="text-[11px] text-[#768390] mt-0.5">{Math.round(p.pct * 100)}% del pozo</div>
            {p.lider && (
              <div className="mt-3 pt-3 border-t border-[#21262d]">
                <div className="text-[10px] text-[#768390] uppercase tracking-wide">Va ganando</div>
                <div className="text-sm font-semibold text-[#e6edf3] truncate mt-0.5">{p.lider.nombre}</div>
                <div className="text-[11px] text-[#9EE637]">{p.lider.detalle}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-sm text-[#768390]">
        <p>
          ℹ️ El premio de <strong className="text-[#e6edf3]">fase de grupos</strong> ({Math.round(pctGrupos * 100)}%)
          es para quien haga <strong className="text-[#e6edf3]">más puntos solo en los partidos de la fase de grupos</strong>.
          El 1er y 2do puesto se definen por el puntaje total al final del Mundial. Mientras tanto, aquí ves quién va ganando cada bolsa.
        </p>
      </div>
    </div>
  )
}
