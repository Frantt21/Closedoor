-- ==============================================
-- Migration 030: Pronouns
-- ==============================================
-- Añade columna para que los usuarios puedan
-- indicar sus pronombres (ej: "él/elle", "ella",
-- "they/them") y se muestren junto al nombre
-- de usuario.
-- ==============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns TEXT DEFAULT NULL;

COMMENT ON COLUMN profiles.pronouns IS 'User pronouns (e.g. he/him, she/her, they/them). Displayed next to username.';
