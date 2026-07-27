-- 040_add_user_status_updated_at.sql
-- Añade columna para tracking de última actualización de estado
-- para detectar usuarios desconectados (staleness > 2 min)

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS user_status_updated_at TIMESTAMPTZ DEFAULT now();
