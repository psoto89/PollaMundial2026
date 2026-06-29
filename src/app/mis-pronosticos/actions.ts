'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { BRACKET_2026 } from '@/config/bracket2026'

export interface SavePredResult {
  ok: boolean
  error?: string
}

const VALID_SLOTS = new Set(BRACKET_2026.map((s) => s.slot))

function validScore(n: number | null): boolean {
  return n === null || (Number.isInteger(n) && n >= 0 && n <= 99)
}

/**
 * Guarda (o actualiza) el pick del cuadro eliminatorio (Polla 2) para un slot:
 * a quién avanza + marcador de 90'. Doble candado: re-verifica el cierre en el
 * servidor (RPC is_bracket_slot_open: deadline + ronda abierta + activación) y el
 * RLS de predictions_bracket lo fuerza igualmente.
 */
export async function saveBracketSlot(
  slot: string,
  advancerTeamId: string | null,
  predLocal: number | null,
  predVisitante: number | null,
): Promise<SavePredResult> {
  if (!VALID_SLOTS.has(slot)) return { ok: false, error: 'Slot inválido' }
  if (!validScore(predLocal) || !validScore(predVisitante)) {
    return { ok: false, error: 'Marcador inválido' }
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }

  const { data: account } = await supabase
    .from('participant_accounts')
    .select('participant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!account) return { ok: false, error: 'Tu cuenta no está vinculada a un participante' }

  // Candado server-side (defensa en profundidad; el RLS también lo fuerza)
  const { data: isOpen, error: rpcErr } = await supabase.rpc('is_bracket_slot_open', { p_slot: slot })
  if (rpcErr) return { ok: false, error: 'No se pudo validar el cierre' }
  if (!isOpen) return { ok: false, error: 'El pronóstico de este partido ya cerró' }

  const { error } = await supabase
    .from('predictions_bracket')
    .upsert(
      {
        participant_id: account.participant_id,
        slot,
        advancer_team_id: advancerTeamId,
        pred_local: predLocal,
        pred_visitante: predVisitante,
      },
      { onConflict: 'participant_id,slot' },
    )

  if (error) {
    // El RLS rechaza si no es dueño o el slot ya cerró
    return { ok: false, error: 'No se pudo guardar (cerrado o sin permiso)' }
  }

  revalidatePath('/mis-pronosticos')
  return { ok: true }
}
