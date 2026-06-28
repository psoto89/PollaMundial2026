-- ============================================================
-- Gran Polla Mundial 2026 — Fase 2 (tabla "Posiciones" por ronda)
-- Migración 006: subtotales de eliminación por ronda + conteo de pronósticos
-- Aplicar en: Supabase SQL Editor (idempotente)
-- ============================================================

-- ─── 1. Subtotales por ronda en scores_cache ──────────────────
-- Los chips de la tabla (Grupos · R32 · R16 · QF · SF · Final) necesitan el
-- desglose por ronda. total_eliminacion sigue siendo la suma de los cinco.
-- 'tercer_puesto' se pliega en total_final.
alter table scores_cache add column if not exists total_r32   int not null default 0;
alter table scores_cache add column if not exists total_r16   int not null default 0;
alter table scores_cache add column if not exists total_qf    int not null default 0;
alter table scores_cache add column if not exists total_sf    int not null default 0;
alter table scores_cache add column if not exists total_final int not null default 0;

-- ─── 2. Conteo público de pronósticos por partido ─────────────
-- Para mostrar "N/M predicciones" sin exponer los marcadores (RLS oculta los
-- valores de eliminación hasta el cierre). SECURITY DEFINER salta el RLS pero
-- solo devuelve un COUNT, nunca filas.
create or replace function prediction_count(m_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from predictions_group where match_id = m_id
$$;

-- Conteo de pronósticos de TODOS los partidos en una sola llamada (para la UI).
create or replace function prediction_counts()
returns table(match_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select match_id, count(*)::int as n
  from predictions_group
  group by match_id
$$;

grant execute on function prediction_count(uuid) to anon, authenticated;
grant execute on function prediction_counts() to anon, authenticated;
