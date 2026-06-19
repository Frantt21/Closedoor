-- Migration 012: Add stats_visibility JSONB column for per-stat granularity
-- Permite controlar individualmente qué estadísticas son visibles
-- cuando el perfil tiene stats_private = true (o incluso si es false, 
-- el campo se ignorará y todas serán visibles).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stats_visibility JSONB DEFAULT NULL;

-- Formato esperado:
--   { "posts": true, "likes": false, "comments": true, "reposts": false, "views": true, "profileViews": false, "saves": true }
--   true = visible, false = oculto
--   NULL (default) = comportamiento legacy: todas ocultas cuando stats_private = true

-- Lógica de aplicación:
--   Si stats_private = false → todas las stats visibles (ignora stats_visibility)
--   Si stats_private = true → usa stats_visibility para cada stat
--     Si stats_visibility es NULL → todas ocultas (legacy)
--     Si stats_visibility tiene valores → cada stat sigue su propio valor

COMMENT ON COLUMN profiles.stats_visibility IS 
  'JSONB object with per-stat visibility: {"posts":bool, "likes":bool, "comments":bool, "reposts":bool, "views":bool, "profileViews":bool, "saves":bool}. null = legacy (all hidden when stats_private=true)';
