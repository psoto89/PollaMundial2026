import { createClient } from '@/lib/supabase/server'

export const revalidate = 3600

interface ScoreRow {
  total: number
  participants: { nombre: string } | null
}

export default async function PremiacionPage() {
  const supabase = await createClient()

  const { data: prize } = await supabase
    .from('prize_pool')
    .select('*')
    .limit(1)
    .single()

  const { data: scoresRaw } = await supabase
    .from('scores_cache')
    .select('total, participants(nombre)')
    .order('total', { ascending: false })

  const scores = (scoresRaw ?? []) as unknown as ScoreRow[]
  const top3 = scores.slice(0, 3)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#e6edf3]">🏆 Premiación</h1>
        <p className="text-sm text-[#768390] mt-1">Reparto del pozo según la hoja PREMIACIÓN</p>
      </div>

      {prize ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {([
              { pct: prize.pct_primero as number, label: '🥇 1er puesto', color: '#ffa657' },
              { pct: prize.pct_segundo as number, label: '🥈 2do puesto', color: '#768390' },
              { pct: prize.pct_grupos as number,  label: '⚽ Fase grupos', color: '#9EE637' },
            ] as const).map(({ pct, label, color }, idx) => (
              <div key={idx} className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-center">
                <div className="text-2xl font-black tabular-nums" style={{ color }}>
                  {Math.round(Number(pct) * 100)}%
                </div>
                <div className="text-xs text-[#768390] mt-1">{label}</div>
                {top3[idx] && (
                  <div className="text-sm font-medium text-[#e6edf3] mt-2 truncate">
                    {top3[idx].participants?.nombre}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-sm text-[#768390]">
            <p>ℹ️ El ganador de la <strong className="text-[#e6edf3]">fase de grupos</strong> ({Math.round(Number(prize.pct_grupos) * 100)}%) es el participante con más puntos solo en la sección de partidos de grupos.</p>
          </div>
        </>
      ) : (
        <div className="text-center py-16 text-[#768390]">
          <p>Sin datos de premiación. Importa el Excel primero.</p>
        </div>
      )}
    </div>
  )
}
