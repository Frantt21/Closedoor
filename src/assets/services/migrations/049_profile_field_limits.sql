-- ==============================================
-- Migration 049: Límites coherentes de caracteres
-- ==============================================
-- Aplica límites de longitud a nivel de DB para:
--   - profiles.username     → 3–20 caracteres (letras, números, _)
--   - profiles.displayname  → máx 50
--   - profiles.pronouns     → máx 30
--   - chat_nicknames.nickname → máx 50
--
-- Todas las constraints se agregan con NOT VALID: las filas EXISTENTES no se
-- escanean ni se rechazan (la migración nunca falla por datos previos), y solo
-- los inserts/updates NUEVOS quedan validados. El frontend (Register/Modal/
-- profile/userService) ya aplica los mismos límites, esto es la red de seguridad.
-- ==============================================

-- Username: entre 3 y 20 caracteres
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_length_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_username_length_check
  CHECK (username IS NULL OR (char_length(username) BETWEEN 3 AND 20)) NOT VALID;

-- Displayname: máx 50 caracteres
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_displayname_length_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_displayname_length_check
  CHECK (displayname IS NULL OR char_length(displayname) <= 50) NOT VALID;

-- Pronouns: máx 30 caracteres
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pronouns_length_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_pronouns_length_check
  CHECK (pronouns IS NULL OR char_length(pronouns) <= 30) NOT VALID;

-- Chat nicknames: máx 50 caracteres
-- (la tabla se creó fuera del repo, se protege por si no existe en algún entorno)
DO $$
BEGIN
  IF to_regclass('public.chat_nicknames') IS NOT NULL THEN
    ALTER TABLE public.chat_nicknames DROP CONSTRAINT IF EXISTS chat_nicknames_nickname_length_check;
    ALTER TABLE public.chat_nicknames ADD CONSTRAINT chat_nicknames_nickname_length_check
      CHECK (nickname IS NULL OR char_length(nickname) <= 50) NOT VALID;
  END IF;
END $$;
