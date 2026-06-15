'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ParticipantAnswer {
  participante: string
  respuesta: string | null
  match: boolean | null
}

interface QuestionComparison {
  key: string
  label: string
  official: string | null
  answers: ParticipantAnswer[]
}

const QUESTION_LABELS: Record<string, string> = {
  p1: '¿Primer gol del Mundial?',
  p2: '¿Goleador del Mundial?',
  p3: '¿Goles del goleador?',
  p4: '¿Máximo asistidor?',
  p5: '¿Equipo con más goles?',
  p6: '¿Goles en la Final?',
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function answersMatch(a: string | null, b: string | null): boolean | null {
  if (!b) return null
  if (!a) return false
  const na = Number(a); const nb = Number(b)
  if (!isNaN(na) && !isNaN(nb)) return na === nb
  const na2 = normalizeText(a); const nb2 = normalizeText(b)
  if (na2 === nb2) return true
  if (na2.length >= 3 && nb2.length >= 3) return na2.includes(nb2) || nb2.includes(na2)
  return false
}

export default function AdminPreguntasPage() {
  const [data, setData] = useState<QuestionComparison[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [
      { data: participants },
      { data: allAnswers },
      { data: officialRaw },
    ] = await Promise.all([
      supabase.from('participants').select('id, nombre').order('nombre'),
      supabase.from('predictions_questions').select('participant_id, pregunta_key, respuesta'),
      supabase.from('official_results').select('key, value').eq('scope', 'question'),
    ])

    const officialMap = new Map(
      (officialRaw ?? []).map((r: { key: string; value: { answer?: string } }) => [
        r.key,
        r.value?.answer ? String(r.value.answer) : null,
      ])
    )

    const answersByQ = new Map<string, Map<string, string | null>>()
    for (const ans of allAnswers ?? []) {
      const q = (ans as { participant_id: string; pregunta_key: string; respuesta: string | null })
      if (!answersByQ.has(q.pregunta_key)) answersByQ.set(q.pregunta_key, new Map())
      answersByQ.get(q.pregunta_key)!.set(q.participant_id, q.respuesta)
    }

    const comparisons: QuestionComparison[] = Object.keys(QUESTION_LABELS).map((key) => {
      const official = officialMap.get(key) ?? null
      const byParticipant = answersByQ.get(key) ?? new Map()
      const answers: ParticipantAnswer[] = (participants ?? []).map((p: { id: string; nombre: string }) => {
        const respuesta = byParticipant.get(p.id) ?? null
        return {
          participante: p.nombre,
          respuesta,
          match: answersMatch(respuesta, official),
        }
      })
      return { key, label: QUESTION_LABELS[key], official, answers }
    })

    setData(comparisons)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="text-[#768390] text-sm py-8">Cargando…</div>

  const acertadoresTotal = data.flatMap((q) => q.answers.filter((a) => a.match === true))
  const ptsTotales = acertadoresTotal.length * 7

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Comparación de respuestas</h1>
        <p className="text-sm text-[#768390] mt-0.5">
          Verde = match automático · Rojo = no coincide · Gris = sin respuesta oficial aún
        </p>
      </div>

      <div className="bg-[#161b22] border border-[#30363d] rounded-xl px-4 py-3 flex items-center gap-6 text-sm">
        <span className="text-[#768390]">Aciertos detectados:</span>
        <span className="font-bold text-[#9EE637]">{acertadoresTotal.length}</span>
        <span className="text-[#768390]">Puntos en juego:</span>
        <span className="font-bold text-[#9EE637]">+{ptsTotales} pts</span>
      </div>

      <div className="space-y-4">
        {data.map((q) => {
          const aciertos = q.answers.filter((a) => a.match === true).length
          return (
            <div key={q.key} className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#21262d] flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-xs font-mono text-[#768390]">{q.key.toUpperCase()}</span>
                  <p className="text-sm font-semibold text-[#e6edf3]">{q.label}</p>
                </div>
                <div className="flex items-center gap-3">
                  {q.official ? (
                    <span className="text-xs bg-[#9EE637]/15 text-[#9EE637] font-semibold px-2 py-1 rounded">
                      Oficial: {q.official}
                    </span>
                  ) : (
                    <span className="text-xs text-[#444d56] bg-[#21262d] px-2 py-1 rounded">Sin respuesta oficial</span>
                  )}
                  {q.official && (
                    <span className="text-xs text-[#768390]">{aciertos}/{q.answers.length} acertaron</span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-[#21262d]">
                {q.answers.map((a) => (
                  <div key={a.participante} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm text-[#768390] w-40 shrink-0 truncate">{a.participante}</span>
                    <span className="flex-1 text-sm text-[#e6edf3] font-medium">
                      {a.respuesta ?? <span className="text-[#444d56] italic">sin respuesta</span>}
                    </span>
                    <span className="shrink-0">
                      {a.match === true && (
                        <span className="text-xs font-bold text-[#9EE637] bg-[#9EE637]/10 px-2 py-0.5 rounded">
                          ✓ +7
                        </span>
                      )}
                      {a.match === false && (
                        <span className="text-xs text-[#f85149] bg-[#f85149]/10 px-2 py-0.5 rounded">✗</span>
                      )}
                      {a.match === null && (
                        <span className="text-xs text-[#444d56]">—</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
