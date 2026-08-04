-- ==============================================
-- Migration 053 (v2): Proteger columna email (a prueba de balas)
-- ==============================================
-- Problema detectado en la auditoría: la columna email de profiles era
-- legible por anon (SELECT id, email, username FROM profiles → TODOS los
-- emails). El REVOKE de columna simple no surtió efecto en el proyecto
-- (Supabase puede re-aplicar grants por defecto), así que esta versión usa
-- el enfoque garantizado:
--
--   1. REVOKE ALL de la tabla para anon/authenticated → elimina cualquier
--      grant previo (de columna, de tabla o de default privileges).
--   2. GRANT explícito POR COLUMNA de lo que la app realmente necesita:
--        - SELECT:  las 52 columnas públicas (SIN email)
--        - INSERT:  id, email, username, displayname, created_at
--                   (email solo de ESCRITURA: el propio usuario al registrarse)
--        - UPDATE:  las 52 columnas públicas (SIN email)
--        - DELETE:  tabla completa (RLS controla filas)
--   3. El email solo se LEE vía RPCs SECURITY DEFINER (login por username
--      y check de registro) → devuelven text|boolean, nunca la tabla.
--
-- Es idempotente: se puede volver a ejecutar sin error.
-- ==============================================

-- ══════════════════════════════════════════════════
-- 1. Eliminar TODOS los grants previos de la tabla
-- ══════════════════════════════════════════════════
REVOKE ALL ON public.profiles FROM anon, authenticated;

-- ══════════════════════════════════════════════════
-- 2. Grants explícitos por columna (SIN email en SELECT/UPDATE)
-- ══════════════════════════════════════════════════
GRANT SELECT (id, username, avatar_url, bio, created_at, updated_at, banner_url, followers, followings, roles, social_links, accent_color, is_private, interests, stats_private, stats_visibility, profile_views_count, banner_position, avatar_position, accent_color_secondary, accent_surface_color, accent_surface_glass, show_accent_profile, accent_visibility, show_accent_explore, show_interests, show_profile_stats, show_trending, profile_background_url, profile_background_position, profile_background_blur, profile_background_dim, show_likes, show_saves, allow_mention, allow_encrypted_add, pronouns, banner_credits, avatar_credits, profile_text_color, banner_dim, filter_encrypted, show_accent, displayname, time_format_24h, theme, locale, show_badges, badges_visibility, user_status, user_status_updated_at, song) ON public.profiles TO anon, authenticated;

GRANT INSERT (id, email, username, displayname, created_at) ON public.profiles TO anon, authenticated;

GRANT UPDATE (id, username, avatar_url, bio, created_at, updated_at, banner_url, followers, followings, roles, social_links, accent_color, is_private, interests, stats_private, stats_visibility, profile_views_count, banner_position, avatar_position, accent_color_secondary, accent_surface_color, accent_surface_glass, show_accent_profile, accent_visibility, show_accent_explore, show_interests, show_profile_stats, show_trending, profile_background_url, profile_background_position, profile_background_blur, profile_background_dim, show_likes, show_saves, allow_mention, allow_encrypted_add, pronouns, banner_credits, avatar_credits, profile_text_color, banner_dim, filter_encrypted, show_accent, displayname, time_format_24h, theme, locale, show_badges, badges_visibility, user_status, user_status_updated_at, song) ON public.profiles TO anon, authenticated;

GRANT DELETE ON public.profiles TO anon, authenticated;

-- ══════════════════════════════════════════════════
-- 3. RPC: resolver email por username (login)
-- ══════════════════════════════════════════════════
-- SECURITY DEFINER: corre como el creador (postgres) → puede leer email.
-- SET search_path evita hijacking de búsqueda de tablas.
CREATE OR REPLACE FUNCTION public.get_email_by_username(uname text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE username = lower(uname)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════
-- 4. RPC: ¿existe el email? (registro)
-- ══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.email_exists(addr text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE email = lower(addr)
  );
$$;

REVOKE ALL ON FUNCTION public.email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════
-- 5. Verificación (opcional): esta consulta debe devolver
--    email solo como INSERTABLE, nunca como SELECTABLE.
-- ══════════════════════════════════════════════════
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'profiles' AND column_name = 'email';
