-- ============================================================
-- Gran Polla Mundial 2026 — Polla 2 reconvertida a BRACKET INTERACTIVO
-- Migración 007: picks de "quién avanza" por slot + activación + bonos de cuadro
-- Aplicar en: Supabase SQL Editor (idempotente). Requiere 005 (bracket_slot) y 006.
--
-- Modelo nuevo de la Polla 2 (Eliminación):
--   El usuario llena TODO el cuadro: por cada slot elige el equipo que avanza y el
--   marcador de 90'+reposición. Las rondas posteriores muestran los equipos que el
--   propio usuario predijo, por eso las predicciones se anclan al SLOT del bracket
--   (R32-01..F, 3P), no al match_id real. Reemplaza el uso de predictions_group para
--   la fase de eliminación (predictions_group queda solo para grupos).
-- ============================================================

-- ─── 1. Resultado oficial: quién avanzó de cada partido ───────
-- El marcador (goles_local/visitante) es SIEMPRE de 90'+reposición; el equipo que
-- clasifica puede diferir por tiempo extra/penales, así que se guarda aparte.
alter table matches add column if not exists advancer_team_id uuid references teams(id);
comment on column matches.advancer_team_id is
  'Equipo que clasificó/avanzó de este partido de eliminación (tras ET/penales si aplica).';

-- ─── 2. "Desde hoy hacia adelante" ────────────────────────────
-- Solo participan (puntúan y se pueden pronosticar) los partidos cuyo kickoff sea
-- posterior a esta marca. Los ya iniciados/finalizados al activar quedan cerrados.
alter table app_config add column if not exists bracket_activated_at timestamptz;

-- ─── 3. Predicción por slot del bracket ───────────────────────
create table if not exists predictions_bracket (
  id               uuid primary key default gen_random_uuid(),
  participant_id   uuid not null references participants(id) on delete cascade,
  slot             text not null,                         -- 'R32-01'..'F','3P' (src/config/bracket2026.ts)
  advancer_team_id uuid references teams(id),             -- equipo que el usuario cree que avanza
  pred_local       int,                                   -- marcador 90'+reposición
  pred_visitante   int,
  updated_at       timestamptz default now(),
  unique (participant_id, slot)
);
comment on table predictions_bracket is
  'Pick del cuadro eliminatorio (Polla 2): a quién avanza + marcador 90'' por slot.';

-- ─── 4. ¿el slot está abierto para pronosticar? ───────────────
-- Resuelve el partido real por bracket_slot y aplica deadline + ronda abierta +
-- activación. Si aún no hay partido real (rondas futuras sin equipos), abierto sii
-- la ronda está habilitada en open_rounds.
create or replace function is_bracket_slot_open(p_slot text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_round     text;
  v_open      text[];
  v_deadline  int;
  v_activated timestamptz;
  v_kickoff   timestamptz;
  v_found     boolean;
begin
  select open_rounds, deadline_minutes, bracket_activated_at
    into v_open, v_deadline, v_activated
  from app_config where id = 1;

  -- ronda derivada del prefijo del slot
  v_round := case
    when p_slot like 'R32-%' then 'dieciseisavos'
    when p_slot like 'R16-%' then 'octavos'
    when p_slot like 'QF-%'  then 'cuartos'
    when p_slot like 'SF-%'  then 'semis'
    when p_slot = '3P'       then 'tercer_puesto'
    when p_slot = 'F'        then 'final'
    else null
  end;

  if v_round is null or v_open is null or not (v_round = any(v_open)) then
    return false;
  end if;

  select m.kickoff_at, true into v_kickoff, v_found
  from matches m where m.bracket_slot = p_slot limit 1;

  -- aún no hay partido real para el slot → abierto (la ronda ya está habilitada)
  if v_found is null then
    return true;
  end if;
  if v_kickoff is null then
    return true;
  end if;

  -- "desde hoy hacia adelante": los que arrancaron antes de la activación no participan
  if v_activated is not null and v_kickoff < v_activated then
    return false;
  end if;

  return now() < v_kickoff - make_interval(mins => v_deadline);
end;
$$;
grant execute on function is_bracket_slot_open(text) to anon, authenticated;

-- ─── 5. RLS: privacidad + escritura self-service ──────────────
alter table predictions_bracket enable row level security;

-- SELECT: las propias siempre; ajenas solo cuando el slot ya cerró (no filtrar picks)
drop policy if exists "pred_bracket_select" on predictions_bracket;
create policy "pred_bracket_select" on predictions_bracket for select using (
  participant_id = current_participant_id()
  or not is_bracket_slot_open(slot)
);

-- INSERT/UPDATE: solo las propias y solo si el slot está abierto
drop policy if exists "pred_bracket_insert" on predictions_bracket;
create policy "pred_bracket_insert" on predictions_bracket for insert to authenticated
  with check (participant_id = current_participant_id() and is_bracket_slot_open(slot));

drop policy if exists "pred_bracket_update" on predictions_bracket;
create policy "pred_bracket_update" on predictions_bracket for update to authenticated
  using (participant_id = current_participant_id() and is_bracket_slot_open(slot))
  with check (participant_id = current_participant_id() and is_bracket_slot_open(slot));

-- ─── 6. Conteo público de picks por slot (sin exponer marcadores) ─
create or replace function bracket_prediction_counts()
returns table(slot text, n int)
language sql stable security definer set search_path = public as $$
  select slot, count(*)::int as n
  from predictions_bracket
  group by slot
$$;
grant execute on function bracket_prediction_counts() to anon, authenticated;

-- ─── 7. Bonos de cuadro en scores_cache ───────────────────────
-- total_r32..total_final (006) pasan a usar el scoring nuevo (5/2 + clasificado 2).
-- total_eliminacion = Σ(rondas) + Σ(bonos).
alter table scores_cache add column if not exists total_bono_octavos int not null default 0; -- 1×16
alter table scores_cache add column if not exists total_bono_cuartos int not null default 0; -- 2×8
alter table scores_cache add column if not exists total_bono_semis   int not null default 0; -- 5×4
alter table scores_cache add column if not exists total_bono_finales int not null default 0; -- 25+15+10
