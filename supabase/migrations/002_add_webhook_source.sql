-- ============================================================
-- Gran Polla Mundial 2026 — Migración 002
-- Agrega campos para trazabilidad de la fuente del resultado en vivo.
-- ============================================================

-- last_source: quién escribió el último marcador (manual admin / webhook / poll reconciliador)
-- Esto permite que el webhook NO pise una actualización manual reciente.
alter table matches
  add column if not exists last_source       text not null default 'manual'
    check (last_source in ('manual', 'webhook', 'poll')),
  add column if not exists last_source_at    timestamptz;

comment on column matches.last_source is
  'Origen del último update de marcador: manual (admin) | webhook (BallDontLie) | poll (reconciliador).';
comment on column matches.last_source_at is
  'Timestamp del último update de marcador. Usado para proteger updates manuales recientes.';
