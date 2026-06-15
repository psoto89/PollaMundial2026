import { createClient } from '@/lib/supabase/server'
import { scoreGroupMatch } from '@/lib/scoring'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const revalidate = 60

interface Props {
  params: Promise<{ id: string }>
}

interface GroupPredRow {
  pred_local: number
  pred_visitante: number
  matches: {
    id: string
    grupo: string | null
    goles_local: number | null
    goles_visitante: number | null
    estado: string
    equipo_local: { nombre: string } | null
    equipo_visitante: { nombre: string } | null
  } | null
}

interface SemisPredRow {
  puesto: string
  teams: { nombre: string } | null
}

interface QuestionPredRow {
  pregunta_key: string
  respuesta: string | null
}

const QUESTION_LABELS: Record<string, string> = {
  p1: '¿Primer gol del Mundial?',
  p2: '¿Goleador del Mundial?',
  p3: '¿Goles del goleador?',
  p4: '¿Máximo asistidor?',
  p5: '¿Equipo con más goles?',
  p6: '¿Goles en la Final?',
}

const PUESTO_LABELS: Record<string, string> = {
  campeon: '🥇 Campeón',
  subcampeon: '🥈 Subcampeón',
  '3': '🥉 3er puesto',
  '4': '4to puesto',
}

export default async function ParticipantPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const { data: participant } = await supabase
    .from('participants')
    .select('*')
    .eq('id', id)
    .single()

  if (!participant) notFound()

  const [
    { data: scores },
    { data: groupPredsRaw },
    { data: semisPredsRaw },
    { data: questionPreds },
    { data: officialQuestions },
  ] = await Promise.all([
    supabase.from('scores_cache').select('*').eq('participant_id', id).single(),
    supabase
      .from('predictions_group')
      .select(`
        pred_local, pred_visitante,
        matches(
          id, grupo, goles_local, goles_visitante, estado,
          equipo_local:teams!equipo_local_id(nombre),
          equipo_visitante:teams!equipo_visitante_id(nombre)
        )
      `)
      .eq('participant_id', id),
    supabase
      .from('predictions_semis')
      .select('puesto, teams(nombre)')
      .eq('participant_id', id),
    supabase
      .from('predictions_questions')
      .select('pregunta_key, respuesta')
      .eq('participant_id', id)
      .order('pregunta_key'),
    supabase
      .from('official_results')
      .select('key, value')
      .eq('scope', 'question'),
  ])

  const groupPreds = (groupPredsRaw ?? []) as unknown as GroupPredRow[]
  const semisPreds = (semisPredsRaw ?? []) as unknown as SemisPredRow[]
  const qPreds = (questionPreds ?? []) as QuestionPredRow[]

  const officialAnswers = new Map(
    (officialQuestions ?? []).map((r: { key: string; value: Record<string, unknown> }) => [
      r.key,
      (r.value as { answer?: string | number }).answer ?? null,
    ]),
  )

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/" className="text-sm text-[#768390] hover:text-[#9EE637] transition-colors mb-4 inline-block">
          ← Tabla general
        </Link>
        <h1 className="text-2xl font-bold text-[#e6edf3]">{participant.nombre}</h1>
      </div>

      {/* Resumen de puntos */}
      {scores && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: scores.total as number, highlight: true },
            { label: 'Grupos', value: scores.total_grupos as number },
            { label: 'Clasificados', value: scores.total_clasificados as number },
            { label: 'Semis', value: scores.total_semis as number },
            { label: 'Preguntas', value: scores.total_preguntas as number },
          ].map(({ label, value, highlight }) => (
            <div
              key={label}
              className={`bg-[#161b22] border rounded-lg p-3 text-center ${
                highlight ? 'border-[#9EE637]/30' : 'border-[#30363d]'
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${highlight ? 'text-[#9EE637]' : 'text-[#e6edf3]'}`}>
                {value ?? 0}
              </div>
              <div className="text-xs text-[#768390] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Pronósticos de grupos */}
      <div>
        <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">Partidos de grupos</h2>
        <div className="space-y-0.5">
          {groupPreds.map((pred, idx) => {
            const m = pred.matches
            if (!m) return null
            const finished = m.estado === 'finished' && m.goles_local !== null
            let status = '—'
            let statusColor = 'text-[#768390]'
            if (finished) {
              const s = scoreGroupMatch(
                { predLocal: pred.pred_local, predVisitante: pred.pred_visitante },
                { golesLocal: m.goles_local!, golesVisitante: m.goles_visitante! },
              )
              if (s.total === 5) { status = '+5 ✓✓'; statusColor = 'text-[#58a6ff]' }
              else if (s.total === 2) { status = '+2 ✓'; statusColor = 'text-[#9EE637]' }
              else { status = '0 ✗'; statusColor = 'text-[#768390]' }
            }
            return (
              <Link key={m.id ?? idx} href={`/match/${m.id}`}>
                <div className="flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-[#161b22] transition-colors text-sm">
                  <span className="text-xs text-[#768390] w-8 shrink-0 font-mono">G{m.grupo}</span>
                  <span className="flex-1 text-[#e6edf3] truncate min-w-0">
                    {m.equipo_local?.nombre}{' '}
                    <span className="text-[#9EE637] font-mono">{pred.pred_local}–{pred.pred_visitante}</span>{' '}
                    {m.equipo_visitante?.nombre}
                  </span>
                  {finished && (
                    <span className="text-xs text-[#768390] shrink-0 font-mono">
                      {m.goles_local}–{m.goles_visitante}
                    </span>
                  )}
                  <span className={`text-xs font-mono shrink-0 w-14 text-right ${statusColor}`}>
                    {status}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Semis */}
      {semisPreds.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">Puestos finales</h2>
          <div className="space-y-2">
            {semisPreds.map((p) => (
              <div key={p.puesto} className="flex items-center gap-3 py-2.5 px-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                <span className="text-sm text-[#768390] w-28 shrink-0">{PUESTO_LABELS[p.puesto] ?? p.puesto}</span>
                <span className="text-sm font-medium text-[#e6edf3]">{p.teams?.nombre}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preguntas */}
      {qPreds.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-[#e6edf3] mb-3">Preguntas</h2>
          <div className="space-y-2">
            {qPreds.map((q) => {
              const officialAns = officialAnswers.get(q.pregunta_key)
              const isCorrect = officialAns != null
                ? String(q.respuesta ?? '').trim().toLowerCase() === String(officialAns).trim().toLowerCase()
                : null
              return (
                <div key={q.pregunta_key} className="py-2.5 px-3 bg-[#161b22] rounded-lg border border-[#30363d]">
                  <p className="text-xs text-[#768390] mb-1">{QUESTION_LABELS[q.pregunta_key]}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[#e6edf3]">{q.respuesta ?? '—'}</span>
                    {isCorrect === true && <span className="text-xs font-semibold text-[#9EE637]">✓ +7 pts</span>}
                    {isCorrect === false && officialAns != null && (
                      <span className="text-xs text-[#768390]">✗ · Correcto: {String(officialAns)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
