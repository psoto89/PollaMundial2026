-- ============================================================
-- Gran Polla Mundial 2026 — Schema inicial
-- Migración 001: tablas + RLS
-- Aplicar en: Supabase SQL Editor o supabase db push
-- ============================================================

-- ─── Extensiones ──────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Participantes ────────────────────────────────────────────
create table participants (
  id          uuid primary key default uuid_generate_v4(),
  sheet_alias text not null unique,   -- título de hoja: 'Quiroz', 'P. Soto', etc.
  nombre      text not null,           -- nombre real desde F2: 'Alejandro Quiroz'
  avatar_url  text,
  created_at  timestamptz default now()
);
comment on table participants is
  'Participantes de la polla. sheet_alias = nombre de hoja en el Excel, nombre = F2.';

-- ─── Equipos ──────────────────────────────────────────────────
create table teams (
  id      uuid primary key default uuid_generate_v4(),
  nombre  text not null unique,   -- nombre normalizado (sin typos)
  grupo   text not null check (grupo in ('A','B','C','D','E','F','G','H','I','J','K','L')),
  bandera text                   -- URL opcional (emoji o imagen)
);
comment on table teams is 'Equipos del Mundial 2026, derivados del Excel al importar.';

-- ─── Partidos ─────────────────────────────────────────────────
create type fase_type as enum ('grupos', 'dieciseisavos', 'cuartos', 'semis', 'final');
create type estado_partido as enum ('scheduled', 'live', 'finished');

create table matches (
  id                  uuid primary key default uuid_generate_v4(),
  fase                fase_type not null default 'grupos',
  grupo               text check (grupo in ('A','B','C','D','E','F','G','H','I','J','K','L')),
  equipo_local_id     uuid not null references teams(id),
  equipo_visitante_id uuid not null references teams(id),
  match_index         int not null unique, -- 0–71 para grupos, secuencial para el resto
  goles_local         int,
  goles_visitante     int,
  estado              estado_partido not null default 'scheduled',
  minuto              int,
  kickoff_at          timestamptz,
  external_id         text unique          -- futuro: ID en API de fútbol
);
comment on table matches is 'Partidos del Mundial. match_index identifica el partido en el Excel.';
create index matches_estado_idx on matches(estado);
create index matches_grupo_idx on matches(grupo);

-- ─── Pronósticos fase de grupos ───────────────────────────────
create table predictions_group (
  id              uuid primary key default uuid_generate_v4(),
  participant_id  uuid not null references participants(id) on delete cascade,
  match_id        uuid not null references matches(id) on delete cascade,
  pred_local      int not null,
  pred_visitante  int not null,
  unique (participant_id, match_id)
);
create index pred_group_participant_idx on predictions_group(participant_id);
create index pred_group_match_idx on predictions_group(match_id);

-- ─── Pronósticos clasificados ─────────────────────────────────
create table predictions_qualify (
  id              uuid primary key default uuid_generate_v4(),
  participant_id  uuid not null references participants(id) on delete cascade,
  grupo           text not null check (grupo in ('A','B','C','D','E','F','G','H','I','J','K','L')),
  posicion        int not null check (posicion in (1, 2, 3)),
  team_id         uuid not null references teams(id),
  unique (participant_id, grupo, posicion)
);

-- ─── Pronósticos semis / puestos finales ──────────────────────
create type puesto_type as enum ('campeon', 'subcampeon', '3', '4');

create table predictions_semis (
  id              uuid primary key default uuid_generate_v4(),
  participant_id  uuid not null references participants(id) on delete cascade,
  puesto          puesto_type not null,
  team_id         uuid not null references teams(id),
  unique (participant_id, puesto)
);

-- ─── Pronósticos preguntas ────────────────────────────────────
create type pregunta_key_type as enum ('p1', 'p2', 'p3', 'p4', 'p5', 'p6');

create table predictions_questions (
  id              uuid primary key default uuid_generate_v4(),
  participant_id  uuid not null references participants(id) on delete cascade,
  pregunta_key    pregunta_key_type not null,
  respuesta       text,  -- almacenado como texto; comparación normalizada en scoring.ts
  unique (participant_id, pregunta_key)
);

-- ─── Resultados oficiales (clasificados, semis, preguntas) ────
create type scope_resultado as enum ('qualify', 'semis', 'question');

create table official_results (
  id     uuid primary key default uuid_generate_v4(),
  scope  scope_resultado not null,
  key    text not null,  -- p.ej. 'A:1', 'A:2', 'campeon', 'p1', etc.
  value  jsonb not null, -- { team: 'España' } o { answer: 8 }
  unique (scope, key)
);
comment on table official_results is
  'Resultados oficiales de clasificados (scope=qualify, key=GRUPO:POS),
   puestos finales (scope=semis, key=campeon|subcampeon|3|4),
   y preguntas (scope=question, key=p1..p6).';

-- ─── Caché de puntuaciones ────────────────────────────────────
create table scores_cache (
  participant_id      uuid primary key references participants(id) on delete cascade,
  total               int not null default 0,
  total_grupos        int not null default 0,
  total_clasificados  int not null default 0,
  total_semis         int not null default 0,
  total_preguntas     int not null default 0,
  updated_at          timestamptz default now()
);
comment on table scores_cache is
  'Puntuación calculada por participant. Se recalcula al cambiar resultados oficiales.';

-- ─── Pozo de premios ──────────────────────────────────────────
create table prize_pool (
  id           uuid primary key default uuid_generate_v4(),
  pct_primero  numeric not null default 0.6,
  pct_segundo  numeric not null default 0.3,
  pct_grupos   numeric not null default 0.1
);
comment on table prize_pool is 'Porcentajes de reparto leídos de la hoja PREMIACIÓN del Excel.';

-- ─── RLS: lectura pública (anon) en todas las tablas ─────────
alter table participants        enable row level security;
alter table teams               enable row level security;
alter table matches             enable row level security;
alter table predictions_group   enable row level security;
alter table predictions_qualify enable row level security;
alter table predictions_semis   enable row level security;
alter table predictions_questions enable row level security;
alter table official_results    enable row level security;
alter table scores_cache        enable row level security;
alter table prize_pool          enable row level security;

-- Lectura pública (SELECT) para anon y authenticated
create policy "Lectura pública — participants"   on participants        for select using (true);
create policy "Lectura pública — teams"          on teams               for select using (true);
create policy "Lectura pública — matches"        on matches             for select using (true);
create policy "Lectura pública — pred_group"     on predictions_group   for select using (true);
create policy "Lectura pública — pred_qualify"   on predictions_qualify for select using (true);
create policy "Lectura pública — pred_semis"     on predictions_semis   for select using (true);
create policy "Lectura pública — pred_questions" on predictions_questions for select using (true);
create policy "Lectura pública — official"       on official_results    for select using (true);
create policy "Lectura pública — scores"         on scores_cache        for select using (true);
create policy "Lectura pública — prize"          on prize_pool          for select using (true);

-- NO hay policies de INSERT/UPDATE/DELETE para anon ni authenticated.
-- Todas las mutaciones van por API routes server-side con SUPABASE_SERVICE_ROLE_KEY
-- que bypasea RLS, tras validar la cookie admin.

-- ─── Realtime: habilitar en matches y scores_cache ────────────
-- (Activar también en el dashboard de Supabase: Database → Replication → Tables)
-- No requiere SQL extra; solo poner el toggle en el dashboard o usar:
-- alter publication supabase_realtime add table matches;
-- alter publication supabase_realtime add table scores_cache;
