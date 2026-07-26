-- 041_add_system_settings.sql
-- Agrega columnas para settings del sistema que se sincronizan con Supabase

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS time_format_24h BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'es';
