-- ============================================================
-- Gran Polla Mundial 2026 — Fase 2
-- Migración 004: login de participantes + deadlines + self-service eliminación
-- Aplicar en: Supabase SQL Editor (recomendado, fuera de transacción explícita)
--
-- REQUIERE además, en el dashboard de Supabase:
--   Authentication → Providers → Email: activar "Magic Link / Email OTP"
--   Authentication → URL Configuration: agregar
--     https://mundial2026.altotrafico.co/auth/callback  (y http://localhost:3000/auth/callback para dev)
-- ============================================================

-- ─── 1. Fases reales 2026 que faltaban en el enum ─────────────
-- (ronda de 32 = 'dieciseisavos', ronda de 16 = 'octavos', + 'tercer_puesto')
-- IF NOT EXISTS evita error si se re-corre. Para scoring solo importa fase <> 'grupos'.
alter type fase_type add value if not exists 'octavos';
alter type fase_type add value if not exists 'tercer_puesto';

-- ─── 2. Cuentas de participante (email/auth en tabla aparte) ──
-- Separada de `participants` para NO exponer emails bajo su SELECT público.
create table if not exists participant_accounts (
  participant_id uuid primary key references participants(id) on delete cascade,
  email          text not null unique,
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  role           text not null default 'participant',  -- 'participant' | 'super_admin'
  created_at     timestamptz default now()
);
comment on table participant_accounts is
  'Vincula un participante con su usuario de Supabase Auth. Admin pre-asigna el email.';

-- ─── 3. Configuración de la app (deadline configurable) ───────
create table if not exists app_config (
  id               int primary key default 1 check (id = 1),
  deadline_minutes int not null default 60
);
insert into app_config (id) values (1) on conflict do nothing;

-- ─── 4. Nueva dimensión de puntos: eliminación ────────────────
alter table scores_cache add column if not exists total_eliminacion int not null default 0;

-- ─── 5. Funciones helper ──────────────────────────────────────
-- participant_id del usuario logueado (SECURITY DEFINER: lee participant_accounts sin RLS)
create or replace function current_participant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select participant_id from participant_accounts where auth_user_id = auth.uid()
$$;

-- ¿el partido de eliminación está abierto para pronosticar? (antes de kickoff - deadline)
create or replace function is_knockout_open(m_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m, app_config c
    where m.id = m_id
      and m.fase <> 'grupos'
      and m.kickoff_at is not null
      and now() < m.kickoff_at - make_interval(mins => c.deadline_minutes)
  )
$$;

grant execute on function current_participant_id() to anon, authenticated;
grant execute on function is_knockout_open(uuid) to anon, authenticated;

-- ─── 6. RLS: escritura self-service + privacidad eliminación ──
-- Reutilizamos predictions_group para los marcadores de eliminación
-- (misma forma, misma regla de scoring). Las políticas distinguen grupos vs eliminación.

-- Reemplazar el SELECT público actual
drop policy if exists "Lectura pública — pred_group" on predictions_group;

-- SELECT: grupos público; eliminación oculta hasta el cierre; las propias siempre visibles
create policy "pred_group_select" on predictions_group for select using (
  exists (select 1 from matches m where m.id = match_id and m.fase = 'grupos')
  or participant_id = current_participant_id()
  or exists (
    select 1 from matches m, app_config c
    where m.id = match_id and m.kickoff_at is not null
      and now() >= m.kickoff_at - make_interval(mins => c.deadline_minutes)
  )
);

-- INSERT/UPDATE: solo las propias, solo partido de eliminación abierto (deadline real)
create policy "pred_group_insert" on predictions_group for insert to authenticated
  with check (participant_id = current_participant_id() and is_knockout_open(match_id));

create policy "pred_group_update" on predictions_group for update to authenticated
  using (participant_id = current_participant_id() and is_knockout_open(match_id))
  with check (participant_id = current_participant_id() and is_knockout_open(match_id));

-- participant_accounts: cada quien solo ve su propia cuenta; sin acceso público; escritura solo service-role
alter table participant_accounts enable row level security;
drop policy if exists "own_account_select" on participant_accounts;
create policy "own_account_select" on participant_accounts for select to authenticated
  using (auth_user_id = auth.uid());

-- app_config: lectura pública (para countdowns); escritura solo service-role
alter table app_config enable row level security;
drop policy if exists "config_read" on app_config;
create policy "config_read" on app_config for select using (true);

-- ─── 7. Vinculación automática por email al crear el usuario ──
-- Admin pre-asigna el email → cuando el participante entra por magic link, se enlaza.
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update participant_accounts
    set auth_user_id = new.id
    where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
