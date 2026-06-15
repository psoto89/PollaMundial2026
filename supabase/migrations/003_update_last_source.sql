-- Migración 003: agregar 'thesportsdb' como valor válido de last_source
-- y quitar 'webhook'/'poll' que ya no usamos.

-- Eliminar el CHECK anterior y reemplazarlo
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_last_source_check;

ALTER TABLE matches
  ADD CONSTRAINT matches_last_source_check
    CHECK (last_source IN ('manual', 'thesportsdb'));

-- Limpiar valores legacy que pudieron quedar de la arquitectura BDL
UPDATE matches
  SET last_source = 'thesportsdb'
  WHERE last_source IN ('webhook', 'poll');
