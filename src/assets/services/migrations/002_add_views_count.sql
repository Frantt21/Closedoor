-- Agregar columna views_count a la tabla posts
ALTER TABLE posts
ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;

-- Actualizar vistas existentes sumando likes + comments + reposts como valor inicial
-- (opcional: para no empezar desde cero en posts existentes)
UPDATE posts
SET views_count = COALESCE(likes_count, 0) + COALESCE(comments_count, 0) + COALESCE(reposts_count, 0)
WHERE views_count = 0;
