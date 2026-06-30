import { createClient } from '@/lib/supabase/server'
import { getBracketMemberIds, isGruposMember } from '@/lib/pollaMembers'
import { POLLA2_PUBLIC } from '@/config/features'

export const revalidate = 60

// Apuesta por persona (COP). Cada polla tiene su propio pozo = miembros × apuesta.
const APUESTA_POLLA1 = 100_000
// Polla 2 (cuadro): 100.000 por persona; el pozo se reparte 70% al 1º y 30% al 2º.
const APUESTA_POLLA2: number | null = 100_000

interface ScoreRow {
  participant_id: string
  total: number
  total_grupos: number
  total_eliminacion: number
  participants: { nombre: string; sheet_alias: string } | null
}

const cop = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

interface PremioDef {
  label: string
  color: string
  pct: number
  lider: { nombre: string; detalle: string } | null
}

export default async function PremiacionPage() {
  const supabase = await createClient()

  const [{ data: prize }, { data: scoresRaw }, memberIdsArr] = await Promise.all([
    supabase.from('prize_pool').select('*').limit(1).single(),
    supabase
      .from('scores_cache')
      .select('participant_id, total, total_grupos, total_eliminacion, participants(nombre, sheet_alias)')
      .order('total', { ascending: false }),
    getBracketMemberIds(),
  ])

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

  const scores = (scoresRaw ?? []) as unknown as ScoreRow[]
  const memberSet = new Set(memberIdsArr)

  const pctPrimero = Number(prize.pct_primero)
  const pctSegundo = Number(prize.pct_segundo)
  const pctTercero = Number(prize.pct_grupos) // se reutiliza el 3er % (mismo esquema en ambas pollas)

  const nombre = (r: ScoreRow | undefined) => r?.participants?.nombre ?? '—'

  // ── Polla 1 (Grupos): roster original (no cuentas self-service). Total Polla 1
  //    excluye los puntos de eliminación (esos son de la Polla 2). ───────────────
  const p1 = scores.filter((s) => isGruposMember(s.participants?.sheet_alias))
  const p1Total = (r: ScoreRow) => r.total - r.total_eliminacion
  const p1ByTotal = [...p1].sort((a, b) => p1Total(b) - p1Total(a))
  const p1ByGrupos = [...p1].sort((a, b) => b.total_grupos - a.total_grupos)
  const pozoP1 = p1.length * APUESTA_POLLA1

  const premiosP1: PremioDef[] = [
    { label: '🥇 1er puesto', color: '#ffa657', pct: pctPrimero,
      lider: p1ByTotal[0] ? { nombre: nombre(p1ByTotal[0]), detalle: `${p1Total(p1ByTotal[0])} pts` } : null },
    { label: '🥈 2do puesto', color: '#c9d1d9', pct: pctSegundo,
      lider: p1ByTotal[1] ? { nombre: nombre(p1ByTotal[1]), detalle: `${p1Total(p1ByTotal[1])} pts` } : null },
    { label: '⚽ Fase de grupos', color: '#9EE637', pct: pctTercero,
      lider: p1ByGrupos[0] ? { nombre: nombre(p1ByGrupos[0]), detalle: `${p1ByGrupos[0].total_grupos} pts grupos` } : null },
  ]

  // ── Polla 2 (Cuadro): miembros por invitación, ranking por total_eliminacion ──
  const p2 = scores.filter((s) => memberSet.has(s.participant_id))
  const p2ByElim = [...p2].sort((a, b) => b.total_eliminacion - a.total_eliminacion)
  const pozoP2 = APUESTA_POLLA2 !== null ? p2.length * APUESTA_POLLA2 : null

  // Polla 2: solo ganan 1º (70%) y 2º (30%). No hay tercer premio.
  const premiosP2: PremioDef[] = [
    { label: '🥇 1er puesto', color: '#ffa657', pct: 0.70,
      lider: p2ByElim[0] ? { nombre: nombre(p2ByElim[0]), detalle: `${p2ByElim[0].total_eliminacion} pts` } : null },
    { label: '🥈 2do puesto', color: '#c9d1d9', pct: 0.30,
      lider: p2ByElim[1] ? { nombre: nombre(p2ByElim[1]), detalle: `${p2ByElim[1].total_eliminacion} pts` } : null },
  ]

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-[#e6edf3]">🏆 Premiación</h1>
        <p className="text-sm text-[#768390] mt-1">Cada polla tiene su propio pozo y reparto</p>
      </div>

      <PollaPrizes
        accent="#9EE637"
        emoji="⚽"
        titulo="Polla 1 · Fase de Grupos"
        numParticipantes={p1.length}
        apuesta={APUESTA_POLLA1}
        pozo={pozoP1}
        premios={premiosP1}
      />

      {POLLA2_PUBLIC && (
        <PollaPrizes
          accent="#58a6ff"
          emoji="🏆"
          titulo="Polla 2 · Cuadro Eliminatorio"
          numParticipantes={p2.length}
          apuesta={APUESTA_POLLA2}
          pozo={pozoP2}
          premios={premiosP2}
        />
      )}

      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-sm text-[#768390]">
        <p>
          ℹ️ Cada polla reparte su propio pozo (miembros × apuesta). El 1º y 2º se definen por el
          puntaje total de cada polla al final del Mundial. En la <strong className="text-[#e6edf3]">Polla 2</strong> solo
          ganan el 1º (70%) y el 2º (30%); en la Polla 1 el tercer premio va para el mejor en fase de grupos.
          Mientras tanto se ve quién va ganando cada bolsa.
        </p>
      </div>
    </div>
  )
}

// ─── Bloque de premios de una polla ───────────────────────────

function PollaPrizes({
  accent, emoji, titulo, numParticipantes, apuesta, pozo, premios,
}: {
  accent: string
  emoji: string
  titulo: string
  numParticipantes: number
  apuesta: number | null
  pozo: number | null
  premios: PremioDef[]
}) {
  const sinApuesta = apuesta === null || pozo === null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        <h2 className="text-lg font-bold" style={{ color: accent }}>{titulo}</h2>
      </div>

      {/* Pozo total */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 text-center">
        <div className="text-xs font-semibold text-[#768390] uppercase tracking-widest">Pozo total</div>
        {sinApuesta ? (
          <>
            <div className="text-2xl font-black text-[#768390] tabular-nums mt-1">Por definir</div>
            <div className="text-xs text-[#768390] mt-1">{numParticipantes} participantes · falta fijar la apuesta</div>
          </>
        ) : (
          <>
            <div className="text-4xl font-black tabular-nums mt-1" style={{ color: accent }}>{cop(pozo!)}</div>
            <div className="text-xs text-[#768390] mt-1">{numParticipantes} participantes × {cop(apuesta!)}</div>
          </>
        )}
      </div>

      {/* Premios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {premios.map((p, idx) => (
          <div key={idx} className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 text-center">
            <div className="text-xs text-[#768390]">{p.label}</div>
            <div className="text-2xl font-black tabular-nums mt-2" style={{ color: sinApuesta ? '#768390' : p.color }}>
              {sinApuesta || pozo === null ? '—' : cop(pozo * p.pct)}
            </div>
            <div className="text-[11px] text-[#768390] mt-0.5">{Math.round(p.pct * 100)}% del pozo</div>
            {p.lider && (
              <div className="mt-3 pt-3 border-t border-[#21262d]">
                <div className="text-[10px] text-[#768390] uppercase tracking-wide">Va ganando</div>
                <div className="text-sm font-semibold text-[#e6edf3] truncate mt-0.5">{p.lider.nombre}</div>
                <div className="text-[11px]" style={{ color: accent }}>{p.lider.detalle}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
