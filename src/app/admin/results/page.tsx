'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Match {
  id: string
  fase: string
  grupo: string | null
  match_index: number
  bracket_slot: string | null
  goles_local: number | null
  goles_visitante: number | null
  estado: string
  minuto: number | null
  equipo_local_id: string | null
  equipo_visitante_id: string | null
  advancer_team_id: string | null
  equipo_local: { nombre: string } | null
  equipo_visitante: { nombre: string } | null
}

const QUESTION_LABELS: Record<string, string> = {
  p1: '¿Primer gol del Mundial?',
  p2: '¿Goleador del Mundial?',
  p3: '¿Goles del goleador?',
  p4: '¿Máximo asistidor?',
  p5: '¿Equipo con más goles?',
  p6: '¿Goles en la Final?',
}

export default function AdminResultsPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [recalcLoading, setRecalcLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [filterGrupo, setFilterGrupo] = useState<string>('todos')
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null)

  useEffect(() => {
    loadMatches()
    loadQuestionAnswers()
  }, [])

  async function loadMatches() {
    const supabase = createClient()
    const { data } = await supabase
      .from('matches')
      .select(`
        id, fase, grupo, match_index, bracket_slot, goles_local, goles_visitante, estado, minuto,
        equipo_local_id, equipo_visitante_id, advancer_team_id,
        equipo_local:teams!equipo_local_id(nombre),
        equipo_visitante:teams!equipo_visitante_id(nombre)
      `)
      .order('match_index')
    setMatches((data ?? []) as unknown as Match[])
    setLoading(false)
  }

  async function saveMatchResult(
    matchId: string,
    golesLocal: number | null,
    golesVisitante: number | null,
    estado: string,
    minuto: number | null,
    advancerTeamId: string | null | undefined,
  ) {
    setSaving(matchId)
    setMessage('')
    const res = await fetch('/api/admin/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'match',
        matchId,
        golesLocal,
        golesVisitante,
        estado,
        minuto: minuto ?? null,
        // Solo enviar el clasificado en partidos de eliminación
        ...(advancerTeamId !== undefined ? { advancerTeamId } : {}),
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setMessage('✅ Guardado')
      loadMatches()
    } else {
      setMessage(`❌ ${data.error}`)
    }
    setSaving(null)
  }

  async function loadQuestionAnswers() {
    const supabase = createClient()
    const { data } = await supabase
      .from('official_results')
      .select('key, value')
      .eq('scope', 'question')
    if (data) {
      const map: Record<string, string> = {}
      for (const row of data as { key: string; value: { answer?: string } }[]) {
        map[row.key] = row.value?.answer ?? ''
      }
      setQuestionAnswers(map)
    }
  }

  async function saveQuestionAnswer(key: string) {
    setSavingQuestion(key)
    setMessage('')
    const res = await fetch('/api/admin/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'question',
        key,
        value: { answer: questionAnswers[key] ?? '' },
      }),
    })
    const data = await res.json() as { error?: string }
    if (res.ok) {
      setMessage('✅ Pregunta guardada')
    } else {
      setMessage(`❌ ${data.error}`)
    }
    setSavingQuestion(null)
  }

  async function handleRecalc() {
    setRecalcLoading(true)
    setMessage('')
    const res = await fetch('/api/admin/recalc', { method: 'POST' })
    const data = await res.json()
    setMessage(res.ok ? `✅ Recalculado (${data.updated} participantes)` : `❌ ${data.error}`)
    setRecalcLoading(false)
  }

  const grupos = ['todos', 'eliminacion', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
  const gruposCount = matches.filter((m) => m.fase === 'grupos').length
  const elimCount = matches.filter((m) => m.fase !== 'grupos').length
  const filteredMatches =
    filterGrupo === 'todos'
      ? matches.filter((m) => m.fase === 'grupos')
      : filterGrupo === 'eliminacion'
        ? matches.filter((m) => m.fase !== 'grupos')
        : matches.filter((m) => m.grupo === filterGrupo)

  if (loading) {
    return <div className="text-[#768390] text-sm py-8">Cargando partidos…</div>
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#e6edf3]">Cargar resultados</h1>
          <p className="text-sm text-[#768390] mt-0.5">{gruposCount} de grupos · {elimCount} de eliminación</p>
        </div>
        <button
          onClick={handleRecalc}
          disabled={recalcLoading}
          className="px-4 py-2 rounded-lg bg-[#21262d] border border-[#30363d] text-sm text-[#e6edf3] hover:border-[#9EE637]/40 disabled:opacity-50 transition-colors font-medium"
        >
          {recalcLoading ? 'Recalculando…' : '🔄 Recalcular puntos'}
        </button>
      </div>

      {message && (
        <div className={`text-sm px-3 py-2 rounded-lg ${message.startsWith('✅') ? 'bg-[#9EE637]/10 text-[#9EE637]' : 'bg-[#f85149]/10 text-[#f85149]'}`}>
          {message}
        </div>
      )}

      {/* Preguntas oficiales */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[#e6edf3] mb-3">Respuestas oficiales a preguntas</h2>
        <div className="space-y-3">
          {Object.entries(QUESTION_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-3">
              <label className="text-xs text-[#768390] w-44 shrink-0">{label}</label>
              <input
                type="text"
                value={questionAnswers[key] ?? ''}
                onChange={(e) => setQuestionAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder="Ingresa la respuesta oficial"
                className="flex-1 py-1.5 px-2 rounded bg-[#21262d] border border-[#30363d] text-sm text-[#e6edf3] focus:outline-none focus:border-[#9EE637] placeholder:text-[#444d56]"
              />
              <button
                onClick={() => saveQuestionAnswer(key)}
                disabled={savingQuestion === key}
                className="px-3 py-1.5 rounded bg-[#9EE637] text-[#0d1117] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
              >
                {savingQuestion === key ? '…' : 'Guardar'}
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#768390] mt-3">
          Después de guardar respuestas, usa el botón &quot;Recalcular puntos&quot; para actualizar los scores.
        </p>
      </div>

      {/* Filtro por grupo */}
      <div className="flex gap-2 flex-wrap">
        {grupos.map((g) => (
          <button
            key={g}
            onClick={() => setFilterGrupo(g)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterGrupo === g
                ? 'bg-[#9EE637] text-[#0d1117]'
                : 'bg-[#21262d] text-[#768390] hover:text-[#e6edf3]'
            }`}
          >
            {g === 'todos' ? 'Grupos' : g === 'eliminacion' ? '🏆 Eliminación' : `Grupo ${g}`}
          </button>
        ))}
      </div>

      {/* Lista de partidos */}
      <div className="space-y-2">
        {filteredMatches.map((match) => (
          <MatchResultRow
            key={match.id}
            match={match}
            saving={saving === match.id}
            onSave={saveMatchResult}
          />
        ))}
        {filteredMatches.length === 0 && (
          <p className="text-sm text-[#768390] py-4">Sin partidos. Importa el Excel primero.</p>
        )}
      </div>
    </div>
  )
}

// ─── Fila de partido editable ─────────────────────────────────

interface MatchResultRowProps {
  match: Match
  saving: boolean
  onSave: (id: string, gl: number | null, gv: number | null, estado: string, minuto: number | null, advancerTeamId: string | null | undefined) => void
}

function MatchResultRow({ match, saving, onSave }: MatchResultRowProps) {
  const isKnockout = match.fase !== 'grupos'
  const [golesLocal, setGolesLocal] = useState<string>(match.goles_local?.toString() ?? '')
  const [golesVisitante, setGolesVisitante] = useState<string>(match.goles_visitante?.toString() ?? '')
  const [estado, setEstado] = useState(match.estado)
  const [minuto, setMinuto] = useState<string>(match.minuto?.toString() ?? '')
  // Clasificado (solo eliminación): '' = sin definir
  const [advancer, setAdvancer] = useState<string>(match.advancer_team_id ?? '')

  const estadoColors: Record<string, string> = {
    scheduled: 'text-[#768390]',
    live: 'text-[#f85149]',
    finished: 'text-[#9EE637]',
  }

  // Empate a penales sin clasificado: la API no da el ganador de la tanda → el admin
  // debe elegirlo con un clic para que sume el +2 y los bonos de cuadro.
  const needsPenaltyPick =
    isKnockout &&
    match.estado === 'finished' &&
    match.goles_local !== null &&
    match.goles_local === match.goles_visitante &&
    !match.advancer_team_id

  function handleSave() {
    const gl = golesLocal !== '' ? parseInt(golesLocal, 10) : null
    const gv = golesVisitante !== '' ? parseInt(golesVisitante, 10) : null
    const min = minuto !== '' ? parseInt(minuto, 10) : null
    // En grupos no se envía el campo (undefined); en eliminación, '' → null
    const adv = isKnockout ? (advancer === '' ? null : advancer) : undefined
    onSave(match.id, gl, gv, estado, min, adv)
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-[#768390] font-mono">
          {isKnockout ? (match.bracket_slot ?? 'KO') : `G${match.grupo}`} #{match.match_index}
        </span>
        <span className={`text-xs font-semibold ml-auto ${estadoColors[match.estado] ?? ''}`}>
          {match.estado.toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-[#e6edf3] flex-1 min-w-24 truncate text-right">
          {match.equipo_local?.nombre}
        </span>

        <input
          type="number"
          min={0}
          max={20}
          value={golesLocal}
          onChange={(e) => setGolesLocal(e.target.value)}
          className="w-12 text-center py-1 rounded bg-[#21262d] border border-[#30363d] text-[#9EE637] font-bold text-sm focus:outline-none focus:border-[#9EE637]"
          placeholder="–"
        />
        <span className="text-[#768390]">–</span>
        <input
          type="number"
          min={0}
          max={20}
          value={golesVisitante}
          onChange={(e) => setGolesVisitante(e.target.value)}
          className="w-12 text-center py-1 rounded bg-[#21262d] border border-[#30363d] text-[#9EE637] font-bold text-sm focus:outline-none focus:border-[#9EE637]"
          placeholder="–"
        />

        <span className="text-sm text-[#e6edf3] flex-1 min-w-24 truncate">
          {match.equipo_visitante?.nombre}
        </span>

        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="py-1 px-2 rounded bg-[#21262d] border border-[#30363d] text-xs text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
        >
          <option value="scheduled">Programado</option>
          <option value="live">En vivo</option>
          <option value="finished">Finalizado</option>
        </select>

        {estado === 'live' && (
          <input
            type="number"
            min={1}
            max={120}
            value={minuto}
            onChange={(e) => setMinuto(e.target.value)}
            className="w-14 text-center py-1 rounded bg-[#21262d] border border-[#30363d] text-xs text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
            placeholder="min"
          />
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 rounded bg-[#9EE637] text-[#0d1117] text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
        >
          {saving ? '…' : 'Guardar'}
        </button>
      </div>

      {/* Clasificado (solo eliminación): el marcador es el FINAL (incluye alargue);
          si quedan empatados tras 120', el avance se define por penales y se guarda aparte. */}
      {isKnockout && (
        <div className={`flex items-center gap-2 mt-2 pt-2 border-t ${needsPenaltyPick ? 'border-[#f0a020]/40' : 'border-[#21262d]'}`}>
          {needsPenaltyPick && (
            <span className="text-xs text-[#f0a020] shrink-0" title="Empate a penales: la API no da el ganador. Elige el clasificado para que sume el +2 y los bonos.">⚠️ Falta clasificado</span>
          )}
          <span className="text-xs text-[#768390] shrink-0" title="El marcador es el final (incluye alargue). Define quién pasa, sobre todo si quedan empatados tras 120' (penales).">Clasifica:</span>
          <select
            value={advancer}
            onChange={(e) => setAdvancer(e.target.value)}
            className="flex-1 py-1 px-2 rounded bg-[#21262d] border border-[#30363d] text-xs text-[#e6edf3] focus:outline-none focus:border-[#9EE637]"
          >
            <option value="">— sin definir —</option>
            {match.equipo_local_id && (
              <option value={match.equipo_local_id}>{match.equipo_local?.nombre ?? 'Local'}</option>
            )}
            {match.equipo_visitante_id && (
              <option value={match.equipo_visitante_id}>{match.equipo_visitante?.nombre ?? 'Visitante'}</option>
            )}
          </select>
        </div>
      )}
    </div>
  )
}
