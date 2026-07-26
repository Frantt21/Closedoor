-- ==============================================
-- Migration 041: Add filter_encrypted and show_accent to profiles
-- ==============================================
-- Añade columnas que faltaban para que las preferencias
-- de settings persistan en Supabase (no solo localStorage).
-- ==============================================

-- filter_encrypted: si se deben filtrar (ocultar) los posts encriptados/ofuscados
-- del feed del usuario. Default: true (filtrados/ocultos)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS filter_encrypted BOOLEAN DEFAULT true;

-- show_accent: master toggle global para colores de acento en el perfil
-- Controla si el perfil del usuario muestra colores de acento (true) o no (false)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_accent BOOLEAN DEFAULT true;

COMMENT ON COLUMN profiles.filter_encrypted IS 'Filter/hide encrypted/obfuscated posts from the feed. Default: true';
COMMENT ON COLUMN profiles.show_accent IS 'Master toggle for accent colors on the profile. Default: true';
