-- ==============================================
-- Migration 028: Likes & Saves privacy controls
-- ==============================================
-- Añade columnas show_likes y show_saves a la
-- tabla profiles para controlar visibilidad de
-- la pestaña de likes y guardados en el perfil.
-- Por defecto: false (privado).
-- ==============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_likes BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_saves BOOLEAN DEFAULT false;

COMMENT ON COLUMN profiles.show_likes IS 'Controls whether the Likes tab is visible on the profile for other users. Default: false (private)';
COMMENT ON COLUMN profiles.show_saves IS 'Controls whether the Saved tab is visible on your own profile. Default: false (private)';
