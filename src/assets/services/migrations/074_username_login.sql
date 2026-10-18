-- ==============================================
-- Migration 074: Login por username sin filtrar emails
-- ==============================================
-- Historia:
--   053: get_email_by_username(uname) devolvía el email con solo conocer el
--        username (enumeración / scraping de emails).
--   054: REVOKE de anon → el login por username dejó de funcionar.
--   060: REVOKE de authenticated → ni siquiera con sesión.
--   069: DROP COLUMN profiles.email → get_email_by_username y email_exists
--        quedaron apuntando a una columna inexistente (siempre fallaban).
--
-- Problema a resolver:
--   Recuperar el login por username SIN que la base devuelva datos sensibles
--   a quien no demuestre que es el dueño de la cuenta.
--
-- Solución:
--   login_email_by_username(uname, pwd) — SECURITY DEFINER:
--     - Cruza profiles.username con auth.users (el email real vive ahí).
--     - Solo devuelve el email si la contraseña coincide con
--       auth.users.encrypted_password (bcrypt vía pgcrypto).
--     - Contraseña incorrecta / username inexistente → NULL (idéntico),
--       así que NO se pueden enumerar emails ni usernames.
--     - Throttle por (username + IP de x-forwarded-for): 8 fallos en 15 min
--       bloquean temporalmente. Evita fuerza bruta directa al RPC (el CAPTCHA
--       de Turnstile solo protege el endpoint de GoTrue, no este RPC).
--   email_exists(addr) — se reescribe contra auth.users (la columna
--     profiles.email ya no existe). Sigue devolviendo solo boolean.
--
-- Notas de seguridad:
--   - El email devuelto es SIEMPRE el de la cuenta autenticada; el cliente
--     ya lo usará para signInWithPassword (GoTrue revalida la contraseña).
--   - Si el proyecto cambiara el hash de contraseñas a algo distinto de
--     bcrypt ($2a$), el RPC devolvería NULL y el usuario aún puede entrar
--     con email + password. No hay filtración en ese caso.
--
-- Idempotente: se puede volver a ejecutar sin error.
-- ==============================================

-- pgcrypto vive en el schema extensions en Supabase (crypt/bf, $2a$ bcrypt).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ──────────────────────────────────────────────
-- 1. Tabla de throttle (solo accesible por el definer)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.username_login_throttle (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.username_login_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.username_login_throttle FROM anon, authenticated;

-- Para el housekeeping oportunista del final (borrar claves viejas).
CREATE INDEX IF NOT EXISTS idx_username_login_throttle_updated
  ON public.username_login_throttle (updated_at);

-- ──────────────────────────────────────────────
-- 2. RPC: email por username, solo con contraseña correcta
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.login_email_by_username(uname TEXT, pwd TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ip TEXT;
  v_key TEXT;
  v_blocked TIMESTAMPTZ;
  v_email TEXT;
  v_attempts INTEGER;
BEGIN
  IF uname IS NULL OR pwd IS NULL
     OR length(btrim(uname)) = 0 OR length(pwd) = 0 THEN
    RETURN NULL;
  END IF;

  -- IP del cliente vía PostgREST (Supabase expone request.headers como GUC).
  -- En SQL Editor / entornos sin header se usa cadena vacía.
  BEGIN
    v_ip := COALESCE(
      split_part(
        COALESCE((current_setting('request.headers', true)::json) ->> 'x-forwarded-for', ''),
        ',', 1
      ),
      ''
    );
  EXCEPTION WHEN others THEN
    v_ip := '';
  END;

  v_key := md5(lower(btrim(uname)) || '|' || v_ip);

  SELECT blocked_until INTO v_blocked
  FROM public.username_login_throttle
  WHERE key = v_key;

  -- Bloqueado: misma respuesta que credenciales inválidas.
  IF v_blocked IS NOT NULL AND v_blocked > now() THEN
    RETURN NULL;
  END IF;

  SELECT u.email INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.username = lower(btrim(uname))
    AND u.encrypted_password IS NOT NULL
    AND u.encrypted_password = crypt(pwd, u.encrypted_password)
  LIMIT 1;

  IF v_email IS NOT NULL THEN
    DELETE FROM public.username_login_throttle WHERE key = v_key;
    RETURN v_email;
  END IF;

  -- Fallo: contar el intento y bloquear al llegar al límite.
  INSERT INTO public.username_login_throttle AS t (key, attempts, blocked_until, updated_at)
  VALUES (v_key, 1, NULL, now())
  ON CONFLICT (key) DO UPDATE SET
    attempts = CASE
      WHEN t.blocked_until IS NOT NULL AND t.blocked_until <= now() THEN 1
      ELSE t.attempts + 1
    END,
    blocked_until = CASE
      WHEN t.blocked_until IS NOT NULL AND t.blocked_until <= now() THEN NULL
      WHEN t.attempts + 1 >= 8 THEN now() + interval '15 minutes'
      ELSE t.blocked_until
    END,
    updated_at = now()
  RETURNING attempts INTO v_attempts;

  -- Housekeeping: no acumular claves de intentos viejos.
  DELETE FROM public.username_login_throttle
  WHERE updated_at < now() - interval '1 day';

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.login_email_by_username(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_email_by_username(TEXT, TEXT) TO anon, authenticated;

-- ──────────────────────────────────────────────
-- 3. Eliminar el RPC vulnerable (ya no tiene sentido)
-- ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_email_by_username(TEXT);

-- ──────────────────────────────────────────────
-- 4. email_exists — reescribir contra auth.users (profiles.email ya no existe)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_exists(addr TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = lower(btrim(addr))
  );
$$;

REVOKE ALL ON FUNCTION public.email_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_exists(TEXT) TO anon, authenticated;

-- ══════════════════════════════════════════════
-- Verificación (opcional)
-- ══════════════════════════════════════════════
-- Password incorrecta / username inexistente → NULL (no revela nada):
--   SELECT public.login_email_by_username('no_existe_xyz', 'loquesea');
-- Con credenciales válidas → el email de ESA cuenta:
--   SELECT public.login_email_by_username('tu_username', 'tu_password');
-- Grants:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('login_email_by_username', 'email_exists', 'get_email_by_username');
