import { createAdminClient } from '@/lib/supabase/admin'
import CuentasForm, { type ParticipantAccount } from './CuentasForm'

export const revalidate = 0

export default async function AdminCuentasPage() {
  const db = createAdminClient()

  const [{ data: participants }, { data: accounts }] = await Promise.all([
    db.from('participants').select('id, nombre').order('nombre'),
    db.from('participant_accounts').select('participant_id, email, auth_user_id'),
  ])

  const accByPart = new Map(
    ((accounts ?? []) as { participant_id: string; email: string; auth_user_id: string | null }[])
      .map((a) => [a.participant_id, a]),
  )

  const rows: ParticipantAccount[] = ((participants ?? []) as { id: string; nombre: string }[]).map((p) => {
    const acc = accByPart.get(p.id)
    return {
      participantId: p.id,
      nombre: p.nombre,
      email: acc?.email ?? '',
      vinculado: !!acc?.auth_user_id,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Cuentas de participantes</h1>
        <p className="text-sm text-[#768390] mt-1">
          Asigna el email de cada uno. Al entrar por magic link con ese correo, su cuenta se vincula sola.
        </p>
      </div>
      <CuentasForm rows={rows} />
    </div>
  )
}
