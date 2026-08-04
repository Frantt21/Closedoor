-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN 054: Blindar RPCs vulnerables (auditoría en producción)
-- ═══════════════════════════════════════════════════════════════
-- Fecha: agosto 2026
--
-- Problema detectado en auditoría en vivo contra app.foranly.space:
--   1. bump_hashtag_usage  → SECURITY DEFINER sin GRANT/REVOKE → EXECUTE PUBLIC
--      por defecto en Supabase. CONFIRMADO: la anon key creó un hashtag real
--      en la DB (inflar trending / spam).
--   2. unfollow_both_ways  → SECURITY DEFINER sin GRANT/REVOKE → EXECUTE PUBLIC.
--      Un atacante podía des-seguir a cualquier par de usuarios conociendo
--      sus UUIDs (respuesta 204 sin sesión).
--   3. get_email_by_username → SECURITY DEFINER con GRANT a anon+authenticated.
--      Fuga de emails: get_email_by_username('orlndku') → email real sin sesión.
--      (Necesario para login por username, pero permite scraping de emails.)
--
-- Solución:
--   - bump_hashtag_usage: REVOKE PUBLIC + exigir auth.uid() (solo usuarios
--     logueados crean posts con hashtags).
--   - unfollow_both_ways: REVOKE PUBLIC + exigir auth.uid() = blocker_id
--     (solo el que bloquea puede des-followear en ambos sentidos).
--   - get_email_by_username: REVOKE de anon → solo authenticated. El login
--     por username deja de funcionar para anon (el frontend ya lo maneja).
--
-- ⚠️ ORDER: aplicar DESPUÉS de 053 y antes de redeployar el frontend que usa
--    los nuevos mensajes de login (AuthContext: "login por username" pasa a
--    pedir email).
-- ⚠️ No hay rollback automático; para revertir, re-GRANT EXECUTE a anon.
-- ═══════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. bump_hashtag_usage — solo autenticados
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_hashtag_usage(p_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h_id BIGINT;
BEGIN
  -- Solo usuarios con sesión pueden inflar hashtags (crean posts con hashtags)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO hashtags (name, use_count, last_used_at)
  VALUES (LOWER(p_name), 1, NOW())
  ON CONFLICT (name) DO UPDATE SET
    use_count = hashtags.use_count + 1,
    last_used_at = NOW()
  RETURNING id INTO h_id;
  RETURN h_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_hashtag_usage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_hashtag_usage(TEXT) TO authenticated;

-- ──────────────────────────────────────────────
-- 2. unfollow_both_ways — solo el que bloquea
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unfollow_both_ways(blocker_id UUID, blocked_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo el usuario con sesión que está bloqueando puede ejecutarlo
  IF auth.uid() IS NULL OR auth.uid() <> blocker_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Delete follow: blocker unfollows blocked
  DELETE FROM follows
  WHERE follower_id = blocker_id AND following_id = blocked_id;

  -- Delete follow: blocked unfollows blocker
  DELETE FROM follows
  WHERE follower_id = blocked_id AND following_id = blocker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.unfollow_both_ways(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unfollow_both_ways(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────
-- 3. get_email_by_username — solo autenticados
-- ──────────────────────────────────────────────
-- La función en sí no cambia; solo se revoca el acceso anónimo.
-- REVOKE FROM PUBLIC es defensivo (053 ya lo hacía): robusto aunque la
-- migración 053 no se hubiera aplicado completa o el estado difiera.
REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO authenticated;

-- ──────────────────────────────────────────────
-- Verificación (opcional)
-- ──────────────────────────────────────────────
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        COALESCE(array_agg(DISTINCT c.rolname ORDER BY c.rolname) FILTER (WHERE c.rolname IS NOT NULL), '{}') AS granted_to
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
-- LEFT JOIN pg_roles c ON c.oid = d.refobjid
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('bump_hashtag_usage', 'unfollow_both_ways', 'get_email_by_username')
-- GROUP BY p.proname, p.oid;
