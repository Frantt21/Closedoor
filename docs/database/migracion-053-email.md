# Migración 053 (v2) — Proteger columna email (a prueba de balas)

**Dónde:** Supabase SQL Editor New query pegar todo Run
**Nota:** la v1 (REVOKE de columna simple) no surtió efecto. Esta versión revoca TODO y regrantea por columna. Es idempotente — se puede ejecutar de nuevo sin error.

```sql
-- 1. Eliminar TODOS los grants previos de la tabla
REVOKE ALL ON public.profiles FROM anon, authenticated;

-- 2. Grants explícitos por columna (SIN email en SELECT/UPDATE)
GRANT SELECT (id, username, avatar_url, bio, created_at, updated_at, banner_url, followers, followings, roles, social_links, accent_color, is_private, interests, stats_private, stats_visibility, profile_views_count, banner_position, avatar_position, accent_color_secondary, accent_surface_color, accent_surface_glass, show_accent_profile, accent_visibility, show_accent_explore, show_interests, show_profile_stats, show_trending, profile_background_url, profile_background_position, profile_background_blur, profile_background_dim, show_likes, show_saves, allow_mention, allow_encrypted_add, pronouns, banner_credits, avatar_credits, profile_text_color, banner_dim, filter_encrypted, show_accent, displayname, time_format_24h, theme, locale, show_badges, badges_visibility, user_status, user_status_updated_at, song) ON public.profiles TO anon, authenticated;

GRANT INSERT (id, email, username, displayname, created_at) ON public.profiles TO anon, authenticated;

GRANT UPDATE (id, username, avatar_url, bio, created_at, updated_at, banner_url, followers, followings, roles, social_links, accent_color, is_private, interests, stats_private, stats_visibility, profile_views_count, banner_position, avatar_position, accent_color_secondary, accent_surface_color, accent_surface_glass, show_accent_profile, accent_visibility, show_accent_explore, show_interests, show_profile_stats, show_trending, profile_background_url, profile_background_position, profile_background_blur, profile_background_dim, show_likes, show_saves, allow_mention, allow_encrypted_add, pronouns, banner_credits, avatar_credits, profile_text_color, banner_dim, filter_encrypted, show_accent, displayname, time_format_24h, theme, locale, show_badges, badges_visibility, user_status, user_status_updated_at, song) ON public.profiles TO anon, authenticated;

GRANT DELETE ON public.profiles TO anon, authenticated;

-- 3. RPC: resolver email por username (login)
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

-- 4. RPC: ¿existe el email? (registro)
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

-- 5. Verificación (opcional): debe mostrar email solo como INSERTABLE
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_name = 'profiles' AND column_name = 'email';
```
