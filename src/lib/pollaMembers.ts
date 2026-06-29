/**
 * Membresía por polla (modelo mínimo, sin tablas de membresía).
 *
 * - Polla 1 (Grupos): los participantes del roster original (importados por Excel).
 *   Se distinguen porque su sheet_alias NO empieza por 'auth:'.
 * - Polla 2 (Cuadro): quienes entraron por el link de invitación y ya jugaron,
 *   es decir, tienen al menos un pick en predictions_bracket.
 *
 * Usa el service role para no chocar con el RLS de predictions_bracket (que oculta
 * los picks abiertos de terceros). Solo lee ids de participante, nada sensible.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/** IDs de participantes que están jugando la Polla 2 (≥1 pick de bracket). */
export async function getBracketMemberIds(): Promise<string[]> {
  const db = createAdminClient()
  const { data } = await db.from('predictions_bracket').select('participant_id')
  const set = new Set(((data ?? []) as { participant_id: string }[]).map((r) => r.participant_id))
  return [...set]
}

/** ¿El participante pertenece al roster de la Polla 1? (no es una cuenta self-service) */
export function isGruposMember(sheetAlias: string | null | undefined): boolean {
  return !!sheetAlias && !sheetAlias.startsWith('auth:')
}
