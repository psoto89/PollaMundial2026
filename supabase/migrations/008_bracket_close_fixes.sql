-- ============================================================
-- Gran Polla Mundial 2026 — Polla 2: endurecer el cierre de pronósticos
-- Migración 008: arreglos de seguridad del cuadro (auditoría pre-lanzamiento)
-- Aplicar en: Supabase SQL Editor (idempotente).
--
-- Corrige:
--  1) is_bracket_slot_open: un partido real SIN kickoff (o sin partido) ya NO se
--     considera abierto. Antes, un kickoff NULL (p.ej. borrado por error) reabría
--     un partido ya jugado y dejaba pronosticarlo.
--  2) Privacidad: los picks de terceros se revelan según el DEADLINE REAL del
--     partido (now() >= kickoff - deadline), no según open_rounds. Antes, sacar la
--     ronda de open_rounds (o abrir la siguiente) exponía picks de partidos que aún
--     no se jugaban.
-- ============================================================

-- ─── 1. is_bracket_slot_open endurecida ───────────────────────
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

  -- Sin partido real o sin kickoff → NO abierto (antes devolvía true: hueco de cierre)
  if v_found is null or v_kickoff is null then
    return false;
  end if;

  -- "Desde hoy hacia adelante": los que arrancaron antes de la activación no participan
  if v_activated is not null and v_kickoff < v_activated then
    return false;
  end if;

  return now() < v_kickoff - make_interval(mins => v_deadline);
end;
$$;
grant execute on function is_bracket_slot_open(text) to anon, authenticated;

-- ─── 2. Visibilidad pública de un pick (solo por deadline real) ─
-- Un pick de tercero se vuelve público SOLO cuando su partido ya cerró
-- (now() >= kickoff - deadline), independiente de open_rounds.
create or replace function is_bracket_slot_public(p_slot text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_deadline int;
  v_kickoff  timestamptz;
begin
  select deadline_minutes into v_deadline from app_config where id = 1;
  select m.kickoff_at into v_kickoff from matches m where m.bracket_slot = p_slot limit 1;
  if v_kickoff is null then
    return false; -- sin partido/kickoff → no exponer
  end if;
  return now() >= v_kickoff - make_interval(mins => v_deadline);
end;
$$;
grant execute on function is_bracket_slot_public(text) to anon, authenticated;

-- ─── 3. SELECT: propios siempre; ajenos solo tras el cierre real ─
drop policy if exists "pred_bracket_select" on predictions_bracket;
create policy "pred_bracket_select" on predictions_bracket for select using (
  participant_id = current_participant_id()
  or is_bracket_slot_public(slot)
);
