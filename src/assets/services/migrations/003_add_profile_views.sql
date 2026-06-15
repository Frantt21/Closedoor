-- Agregar columna profile_views_count a la tabla profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS profile_views_count INTEGER NOT NULL DEFAULT 0;
