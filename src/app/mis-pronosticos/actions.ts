'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface SavePredResult {
  ok: boolean
  error?: string
}

/**
 * Guarda (o actualiza) el marcador pronosticado de un partido de eliminación.
 * Doble candado: re-verifica el deadline en servidor + el RLS lo fuerza igualmente.
 */
export async function savePrediction(
  matchId: string,
  predLocal: number,
  predVisitante: number,
): Promise<SavePredResult> {
  if (!Number.isInteger(predLocal) || !Number.isInteger(predVisitante) ||
      predLocal < 0 || predVisitante < 0 || predLocal > 99 || predVisitante > 99) {
    return { ok: false, error: 'Marcador inválido' }
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }

  // participant_id del usuario (RLS de participant_accounts permite ver el propio)
  const { data: account } = await supabase
    .from('participant_accounts')
    .select('participant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!account) return { ok: false, error: 'Tu cuenta no está vinculada a un participante' }

  // Re-verificar deadline en servidor (defensa en profundidad; el RLS también lo fuerza)
  const { data: match } = await supabase
    .from('matches')
    .select('id, fase, kickoff_at')
    .eq('id', matchId)
    .single()
  if (!match || match.fase === 'grupos' || !match.kickoff_at) {
    return { ok: false, error: 'Partido no disponible para pronóstico' }
  }

  const { data: cfg } = await supabase
    .from('app_config')
    .select('deadline_minutes, open_rounds')
    .single()

  // La ronda debe estar habilitada por el admin (se abre "por ronda")
  const openRounds = (cfg?.open_rounds as string[] | null) ?? []
  if (!openRounds.includes(match.fase)) {
    return { ok: false, error: 'Esta ronda aún no está habilitada' }
  }

  const deadlineMin = cfg?.deadline_minutes ?? 60
  const deadline = new Date(match.kickoff_at).getTime() - deadlineMin * 60_000
  if (Date.now() >= deadline) {
    return { ok: false, error: 'El pronóstico ya cerró' }
  }

  const { error } = await supabase
    .from('predictions_group')
    .upsert(
      {
        participant_id: account.participant_id,
        match_id: matchId,
        pred_local: predLocal,
        pred_visitante: predVisitante,
      },
      { onConflict: 'participant_id,match_id' },
    )

  if (error) {
    // El RLS rechaza si no es dueño o ya cerró
    return { ok: false, error: 'No se pudo guardar (cerrado o sin permiso)' }
  }

  revalidatePath('/mis-pronosticos')
  return { ok: true }
}
