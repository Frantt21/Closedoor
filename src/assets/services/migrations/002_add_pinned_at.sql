-- Agrega columna pinned_at para ordenar posts fijados
-- Se ejecuta desde el SQL Editor de Supabase

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Actualizar posts existentes que ya están fijados
-- (les ponemos su created_at como pinned_at para mantener orden coherente)
UPDATE posts
SET pinned_at = created_at
WHERE is_pinned = true AND pinned_at IS NULL;
