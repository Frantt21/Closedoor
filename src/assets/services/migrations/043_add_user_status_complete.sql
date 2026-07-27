-- ──────────────────────────────────────────────
-- Migration 043: Add user_status + user_status_updated_at to profiles
-- ──────────────────────────────────────────────
-- Combina 040_add_user_status_updated_at.sql y 042_user_status.sql
-- Valores user_status: 'online' | 'idle' | 'dnd' | 'disconnected'
-- ──────────────────────────────────────────────

-- Columna user_status (esencial para estados en tiempo real)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_status text NOT NULL DEFAULT 'online';

-- Columna user_status_updated_at (para detectar usuarios desconectados por staleness > 2 min)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_status_updated_at TIMESTAMPTZ DEFAULT now();

-- Index para filtros Realtime
CREATE INDEX IF NOT EXISTS idx_profiles_user_status
  ON public.profiles (user_status)
  WHERE user_status != 'disconnected';

-- Activar Realtime para la tabla profiles (si no está ya)
-- Nota: Esto solo funciona si se ejecuta desde el SQL Editor de Supabase
-- con permisos de superusuario. Puedes ignorar el error si ya está activado.
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.profiles;
