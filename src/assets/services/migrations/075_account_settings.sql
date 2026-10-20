-- ==============================================
-- Migration 075: cambio de cuenta (username / email / contraseña)
-- ==============================================
-- Añade la base segura para que Ajustes permita cambiar:
--   - Nombre de usuario (username)
--   - Correo electrónico
--   - Contraseña
--
-- Reglas de seguridad:
--   1. TODOS los cambios exigen la CONTRASEÑA ACTUAL (re-autenticación). Sin
--      ella, una sesión robada (XSS, equipo compartido) podría apropiarse de la
--      cuenta cambiando credenciales.
--   2. La comparación de contraseña se hace con bcrypt (pgcrypto) contra
--      auth.users.encrypted_password, nunca en el cliente.
--   3. Throttle por uid (reutiliza username_login_throttle de 074):
--      10 fallos en 15 minutos bloquean temporalmente verify_password.
--   4. El username se guarda en minúsculas y pasa a tener índice ÚNICO
--      case-insensitive: 040 creó uno NO único y el login por username (074)
--      usa LIMIT 1 → con duplicados podía resolver la cuenta equivocada.
--
-- Idempotente: se puede volver a ejecutar sin error.
-- ==============================================

-- pgcrypto vive en el schema extensions en Supabase (crypt/bf, $2a$ bcrypt).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Tabla de throttle (creada en 074; aquí por si esta migración corre sola).
CREATE TABLE IF NOT EXISTS public.username_login_throttle (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.username_login_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.username_login_throttle FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 1. Índice único case-insensitive del username
-- ──────────────────────────────────────────────
-- Si ya existen duplicados (p. ej. "Ana" y "ana"), el CREATE UNIQUE INDEX
-- fallaría con un error genérico. Se comprueba antes para dar un mensaje útil.
DO $$
DECLARE
  v_dups TEXT;
BEGIN
  SELECT string_agg(u || ' x' || cnt, ', ')
  INTO v_dups
  FROM (
    SELECT lower(username) AS u, count(*) AS cnt
    FROM public.profiles
    WHERE username IS NOT NULL
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) d;

  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION
      'No se puede crear el índice único de usernames: hay duplicados case-insensitive (%). Renómbralos antes de reintentar (ver consulta de diagnóstico).',
      v_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- El índice NO único de 040 ya no aporta nada (el único cubre las consultas).
DROP INDEX IF EXISTS public.idx_profiles_username_lower;

-- ──────────────────────────────────────────────
-- 2. verify_password(pwd) — bcrypt de la cuenta autenticada
-- ──────────────────────────────────────────────
-- Devuelve TRUE solo si `pwd` coincide con el hash de auth.uid().
-- Sin sesión, sin contraseña o con throttle activo → FALSE (sin distinguir
-- motivos, para no dar pistas).
CREATE OR REPLACE FUNCTION public.verify_password(pwd TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_key TEXT;
  v_blocked TIMESTAMPTZ;
  v_ok BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR pwd IS NULL OR length(pwd) = 0 THEN
    RETURN FALSE;
  END IF;

  v_key := 'uid:' || v_uid::text;

  SELECT blocked_until INTO v_blocked
  FROM public.username_login_throttle
  WHERE key = v_key;

  IF v_blocked IS NOT NULL AND v_blocked > now() THEN
    RETURN FALSE;
  END IF;

  SELECT (u.encrypted_password IS NOT NULL
          AND u.encrypted_password = crypt(pwd, u.encrypted_password))
  INTO v_ok
  FROM auth.users u
  WHERE u.id = v_uid;

  IF COALESCE(v_ok, FALSE) THEN
    DELETE FROM public.username_login_throttle WHERE key = v_key;
    RETURN TRUE;
  END IF;

  -- Fallo: contar y bloquear al llegar a 10 intentos.
  INSERT INTO public.username_login_throttle AS t (key, attempts, blocked_until, updated_at)
  VALUES (v_key, 1, NULL, now())
  ON CONFLICT (key) DO UPDATE SET
    attempts = CASE
      WHEN t.blocked_until IS NOT NULL AND t.blocked_until <= now() THEN 1
      ELSE t.attempts + 1
    END,
    blocked_until = CASE
      WHEN t.blocked_until IS NOT NULL AND t.blocked_until <= now() THEN NULL
      WHEN t.attempts + 1 >= 10 THEN now() + interval '15 minutes'
      ELSE t.blocked_until
    END,
    updated_at = now();

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_password(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_password(TEXT) TO authenticated;

-- ──────────────────────────────────────────────
-- 3. change_username(new_username, pwd)
-- ──────────────────────────────────────────────
-- Devuelve un CÓDIGO estable (el cliente lo traduce):
--   'ok' | 'not_authenticated' | 'invalid_username' | 'invalid_password'
--   | 'same' | 'taken'
CREATE OR REPLACE FUNCTION public.change_username(new_username TEXT, pwd TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_new TEXT := lower(btrim(COALESCE(new_username, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'not_authenticated';
  END IF;

  -- Mismas reglas que el registro: 3-20, letras/números/guion bajo.
  IF v_new !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN 'invalid_username';
  END IF;

  -- Re-autenticación obligatoria (también aplica throttle).
  IF NOT public.verify_password(pwd) THEN
    RETURN 'invalid_password';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND username = v_new
  ) THEN
    RETURN 'same';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = v_new AND id <> v_uid
  ) THEN
    RETURN 'taken';
  END IF;

  -- Marca transaccional que autoriza el UPDATE (el trigger de abajo bloquea
  -- cualquier cambio de username que no venga de este RPC).
  PERFORM set_config('fc.allow_username_change', 'on', true);

  BEGIN
    UPDATE public.profiles
    SET username = v_new,
        updated_at = now()
    WHERE id = v_uid;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera entre la comprobación y el UPDATE.
    RETURN 'taken';
  END;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.change_username(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_username(TEXT, TEXT) TO authenticated;

-- ──────────────────────────────────────────────
-- 4. Bloquear cambios de username por PATCH directo
-- ──────────────────────────────────────────────
-- 071 dejó GRANT UPDATE a nivel TABLA en profiles (necesario para columnas
-- nuevas). Eso permitiría cambiar el username desde PostgREST SIN contraseña,
-- saltándose esta migración. El trigger exige la marca transaccional que solo
-- pone change_username (SECURITY DEFINER, ya validó la contraseña).
--
-- Nota: email y contraseña viven en auth.users y se cambian vía GoTrue
-- (supabase.auth.updateUser) exigiendo sesión; la re-autenticación de la UI es
-- defensa en profundidad. El username SÍ es aplicable en la BD y se aplica.
CREATE OR REPLACE FUNCTION public.enforce_username_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username
     AND COALESCE(current_setting('fc.allow_username_change', true), '') <> 'on'
     AND auth.uid() IS NOT NULL
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
  THEN
    RAISE EXCEPTION 'username_change_requires_password'
      USING HINT = 'Use the change_username RPC (it verifies the current password).';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_username_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_enforce_username_change ON public.profiles;
CREATE TRIGGER profiles_enforce_username_change
  BEFORE UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_username_change();

-- ══════════════════════════════════════════════
-- Verificación (opcional)
-- ══════════════════════════════════════════════
-- Duplicados (debe devolver 0 filas):
--   SELECT lower(username), count(*) FROM public.profiles
--   WHERE username IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- Índice:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'profiles' AND indexname LIKE '%username%';
-- Grants:
--   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN ('verify_password', 'change_username');
-- Trigger (PATCH directo del username debe fallar con
-- 'username_change_requires_password'):
--   UPDATE public.profiles SET username = username || 'x' WHERE id = auth.uid();
-- Con el RPC (contraseña correcta) debe devolver 'ok':
--   SELECT public.change_username('nuevo_username', 'tu_password');
