import { createAdminClient } from '@/lib/supabase/admin'
import CuentasForm, { type ParticipantAccount, type UnlinkedUser, type ParticipantOption } from './CuentasForm'

export const revalidate = 0

export default async function AdminCuentasPage() {
  const db = createAdminClient()

  const [{ data: participants }, { data: accounts }, authList] = await Promise.all([
    db.from('participants').select('id, nombre, sheet_alias').order('nombre'),
    db.from('participant_accounts').select('participant_id, email, auth_user_id'),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  const accList = (accounts ?? []) as { participant_id: string; email: string; auth_user_id: string | null }[]
  const accByPart = new Map(accList.map((a) => [a.participant_id, a]))
  const linkedAuthIds = new Set(accList.map((a) => a.auth_user_id).filter(Boolean) as string[])

  const partList = (participants ?? []) as { id: string; nombre: string; sheet_alias: string }[]

  const rows: ParticipantAccount[] = partList.map((p) => {
    const acc = accByPart.get(p.id)
    return {
      participantId: p.id,
      nombre: p.nombre,
      email: acc?.email ?? '',
      vinculado: !!acc?.auth_user_id,
      // Cuenta self-service (entró por el login, no es del roster de la Etapa 1)
      selfJoin: p.sheet_alias?.startsWith('auth:') ?? false,
    }
  })

  // Cuentas de Supabase Auth que aún no están vinculadas a ningún participante
  const unlinkedUsers: UnlinkedUser[] = (authList.data?.users ?? [])
    .filter((u) => !linkedAuthIds.has(u.id) && u.email)
    .map((u) => ({ authUserId: u.id, email: u.email as string, createdAt: u.created_at ?? '' }))

  // Participantes que todavía no tienen cuenta vinculada (para el dropdown)
  const participantOptions: ParticipantOption[] = partList
    .filter((p) => !accByPart.get(p.id)?.auth_user_id)
    .map((p) => ({ id: p.id, nombre: p.nombre }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-[#e6edf3]">Cuentas de participantes</h1>
        <p className="text-sm text-[#768390] mt-1">
          Cualquiera puede crear su cuenta en el login. Aquí vinculas cada cuenta nueva a su
          participante de la Etapa 1 (o pre-asignas el email para auto-vinculación).
        </p>
      </div>

      <CuentasForm
        rows={rows}
        unlinkedUsers={unlinkedUsers}
        participantOptions={participantOptions}
      />
    </div>
  )
}
