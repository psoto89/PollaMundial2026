'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { scoreGroupMatch } from '@/lib/scoring'

interface LiveMatch {
  id: string
  grupo: string | null
  match_index: number
  goles_local: number | null
  goles_visitante: number | null
  minuto: number | null
  estado: string
  equipo_local: { id: string; nombre: string } | null
  equipo_visitante: { id: string; nombre: string } | null
}

interface Pred {
  participant_id: string
  match_id: string
  pred_local: number
  pred_visitante: number
  participants: { id: string; nombre: string } | null
}

interface Participant {
  id: string
  nombre: string
}

interface Props {
  initialMatches: LiveMatch[]
  initialPreds: Pred[]
  participants: Participant[]
}

export default function LiveView({ initialMatches, initialPreds, participants }: Props) {
  const [matches, setMatches] = useState<LiveMatch[]>(initialMatches)
  const [preds, setPreds] = useState<Pred[]>(initialPreds)

  // ── Suscripción Realtime a matches ──────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()

    async function refetchLive() {
      const { data: liveMatches } = await supabase
        .from('matches')
        .select(`
          id, grupo, match_index, goles_local, goles_visitante, minuto, estado,
          equipo_local:teams!equipo_local_id(id, nombre),
          equipo_visitante:teams!equipo_visitante_id(id, nombre)
        `)
        .eq('estado', 'live')
      if (liveMatches) {
        setMatches(liveMatches as unknown as LiveMatch[])
        const ids = (liveMatches as { id: string }[]).map((m) => m.id)
        if (ids.length > 0) {
          const { data: newPreds } = await supabase
            .from('predictions_group')
            .select('participant_id, match_id, pred_local, pred_visitante, participants(id, nombre)')
            .in('match_id', ids)
          if (newPreds) setPreds(newPreds as unknown as Pred[])
        } else {
          setPreds([])
        }
      }
    }

    const channel = supabase
      .channel('live-matches')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, refetchLive)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Auto-poll cada 45s mientras hay partidos live ────────────────────────────
  // Llama a /api/live/poll para actualizar marcadores desde BDL (sin webhooks).
  // Solo activo cuando hay matches en vivo; se detiene si no hay ninguno.
  useEffect(() => {
    if (matches.length === 0) return

    const poll = async () => {
      try {
        await fetch('/api/live/poll', { method: 'POST' })
        // El update en Supabase dispara Realtime → el canal de arriba se encarga del render
      } catch {
        // Silencioso — no crítico
      }
    }

    const interval = setInterval(poll, 45_000)
    return () => clearInterval(interval)
  }, [matches.length])

  if (matches.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">En Vivo</h1>
        </div>
        <div className="text-center py-20 text-[#768390]">
          <p className="text-5xl mb-4">⚽</p>
          <p className="text-lg font-medium text-[#e6edf3]">No hay partidos en vivo ahora</p>
          <p className="text-sm mt-2">Los partidos aparecerán aquí cuando empiecen</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className="live-dot w-3 h-3 rounded-full bg-[#f85149]" />
        <h1 className="text-2xl font-bold text-[#e6edf3] tracking-tight">En Vivo</h1>
      </div>

      {matches.map((match) => {
        const matchPreds = preds.filter((p) => p.match_id === match.id)
        return (
          <LiveMatchCard
            key={match.id}
            match={match}
            preds={matchPreds}
            allParticipants={participants}
          />
        )
      })}
    </div>
  )
}

// ─── Tarjeta de partido en vivo ───────────────────────────────

interface LiveMatchCardProps {
  match: LiveMatch
  preds: Pred[]
  allParticipants: Participant[]
}

function LiveMatchCard({ match, preds, allParticipants }: LiveMatchCardProps) {
  const golesLocal = match.goles_local ?? 0
  const golesVisitante = match.goles_visitante ?? 0

  // Calcular puntos actuales para cada participante
  const participantScores = preds.map((pred) => {
    const score = scoreGroupMatch(
      { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
      { golesLocal, golesVisitante },
    )
    return {
      nombre: pred.participants?.nombre ?? pred.participant_id,
      participantId: pred.participant_id,
      predLocal: pred.pred_local,
      predVisitante: pred.pred_visitante,
      puntos: score.total,
      signo: score.signo,
      exacto: score.exacto,
    }
  }).sort((a, b) => b.puntos - a.puntos)

  // Participantes sin pronóstico
  const predParticipantIds = new Set(preds.map((p) => p.participant_id))
  const sinPronostico = allParticipants.filter((p) => !predParticipantIds.has(p.id))

  return (
    <div className="space-y-4">
      {/* Marcador */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#f85149] uppercase tracking-widest flex items-center gap-2">
            <span className="live-dot w-2 h-2 rounded-full bg-[#f85149]" />
            EN VIVO {match.minuto !== null ? `· ${match.minuto}'` : ''}
          </span>
          <span className="text-xs text-[#768390]">Grupo {match.grupo}</span>
        </div>
        <div className="flex items-center justify-between gap-4 mt-4">
          <span className="text-lg font-bold text-[#e6edf3] flex-1 text-right">
            {match.equipo_local?.nombre ?? '—'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_local ?? '–'}
            </span>
            <span className="text-2xl text-[#768390]">–</span>
            <span className="text-4xl font-black text-[#9EE637] tabular-nums w-10 text-center">
              {match.goles_visitante ?? '–'}
            </span>
          </div>
          <span className="text-lg font-bold text-[#e6edf3] flex-1">
            {match.equipo_visitante?.nombre ?? '—'}
          </span>
        </div>
      </div>

      {/* Carrera de puntos */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#21262d]">
          <h3 className="text-sm font-semibold text-[#e6edf3]">Carrera de puntos</h3>
          <p className="text-xs text-[#768390] mt-0.5">Con el marcador actual</p>
        </div>

        <div className="divide-y divide-[#21262d]">
          {participantScores.map((ps, idx) => (
            <div
              key={ps.participantId}
              className={`px-4 py-3 flex items-center gap-3 ${ps.puntos > 0 ? 'bg-[#9EE637]/5' : ''}`}
            >
              <span className="text-xs text-[#768390] w-4 shrink-0 tabular-nums">{idx + 1}</span>
              <span className="flex-1 text-sm font-medium text-[#e6edf3] truncate">
                {ps.nombre}
              </span>
              <span className="text-xs text-[#768390] shrink-0 hidden sm:block">
                {ps.predLocal} – {ps.predVisitante}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {ps.signo > 0 && (
                  <span className="text-[10px] font-semibold bg-[#9EE637]/20 text-[#9EE637] px-1.5 py-0.5 rounded">
                    +{ps.signo} signo
                  </span>
                )}
                {ps.exacto > 0 && (
                  <span className="text-[10px] font-semibold bg-[#58a6ff]/20 text-[#58a6ff] px-1.5 py-0.5 rounded">
                    +{ps.exacto} exacto
                  </span>
                )}
                <span className={`font-bold tabular-nums text-sm w-8 text-right ${ps.puntos > 0 ? 'text-[#9EE637]' : 'text-[#768390]'}`}>
                  {ps.puntos}
                </span>
              </div>
            </div>
          ))}

          {sinPronostico.length > 0 && (
            <div className="px-4 py-2">
              <p className="text-xs text-[#768390]">
                Sin pronóstico: {sinPronostico.map((p) => p.nombre).join(', ')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
