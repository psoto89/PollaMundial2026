-- ============================================================
-- Gran Polla Mundial 2026 — Fase 2 (bracket visible)
-- Migración 005: slot de bracket + habilitación de pronóstico por ronda
-- Aplicar en: Supabase SQL Editor (idempotente)
-- ============================================================

-- ─── 1. Mapear cada partido real a su posición en la plantilla ─
-- bracket_slot conecta matches con src/config/bracket2026.ts
-- (p.ej. 'R32-01', 'R16-03', 'QF-2', 'SF-1', '3P', 'F'). Nullable: los
-- partidos de grupos no lo usan. Unique: un slot = a lo sumo un partido.
alter table matches add column if not exists bracket_slot text;

create unique index if not exists matches_bracket_slot_uidx
  on matches (bracket_slot)
  where bracket_slot is not null;

-- ─── 2. Rondas de eliminación habilitadas para pronosticar ─────
-- Lista de fases abiertas (p.ej. '{dieciseisavos,octavos}'). Vacío = todo
-- cerrado → la rama se ve pero nadie puede llenar marcadores todavía.
-- Pedro va agregando fases "por ronda" desde el admin.
alter table app_config add column if not exists open_rounds text[] not null default '{}';
