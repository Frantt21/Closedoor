-- ==============================================
-- Migration 029: Privacy settings
-- ==============================================
-- Añade columnas a profiles para controlar:
-- - allow_mention: permite que otros usuarios te
--   etiqueten en posts con @mención
-- - allow_encrypted_add: permite que te añadan a
--   la lista de usuarios autorizados en posts
--   encriptados/ofuscados
-- ==============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allow_mention BOOLEAN DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allow_encrypted_add BOOLEAN DEFAULT true;

COMMENT ON COLUMN profiles.allow_mention IS 'Allow other users to @mention you in posts. Default: true';
COMMENT ON COLUMN profiles.allow_encrypted_add IS 'Allow others to add you to encrypted post allowed lists. Default: true';
