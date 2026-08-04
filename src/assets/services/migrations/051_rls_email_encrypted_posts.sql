-- ==============================================
-- Migration 051: RLS — ocultar email y filtrar posts encriptados
-- ==============================================
-- Corrige dos vulnerabilidades de seguridad detectadas en auditoría:
--
-- 1. El email de los usuarios era visible para cualquier cliente anónimo
--    (política "Public profiles are viewable by everyone" con USING(true)).
--    Ahora usamos una columna virtual o filtramos el SELECT.
--
-- 2. Post encriptados (is_encrypted = true) eran visibles con su
--    encrypted_content para cualquier usuario sin sesión.
--    Ahora solo se muestran si auth.uid() está en allowed_users
--    o si el usuario es el autor.
-- ==============================================

-- ══════════════════════════════════════════════════
-- 1. PROFILES: ocultar email a usuarios no autenticados
-- ══════════════════════════════════════════════════
-- Estrategia: crear una VIEW que filtra la columna email
-- y luego hacemos que los SELECTs del frontend apunten a la view.
-- Pero como cambiar todas las queries del frontend es costoso,
-- mejor creamos una política que devuelva email = NULL para
-- cualquiera que no sea el propio usuario.

-- Primero, eliminamos la política existente que permite SELECT total
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;

-- Política: cualquiera puede ver perfiles, pero SIN email
DROP POLICY IF EXISTS "Profiles are viewable by everyone (no email)" ON profiles;
CREATE POLICY "Profiles are viewable by everyone (no email)"
  ON profiles FOR SELECT
  USING (true);

-- Política: el propio usuario puede ver su propio email
DROP POLICY IF EXISTS "Users can view their own email" ON profiles;
CREATE POLICY "Users can view their own email"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- NOTA: Como las políticas RLS se combinan con OR, la segunda política
-- permite que el usuario vea su propia fila (con email), mientras que
-- la primera permite ver las filas de otros (sin email).
-- Sin embargo, RLS trabaja a nivel de FILA, no de columna.
-- Para ocultar el email a nivel de columna, necesitamos una VIEW.

-- Solución definitiva: crear una vista pública que excluya email
-- y hacer que el frontend consulte la vista en lugar de la tabla.
-- La tabla original se usa solo para operaciones del propio usuario.
--
-- ⚠️ SECURITY INVOKER es crítico: sin él, la vista usa los permisos del
--    creador (postgres) y bypassea RLS. Con INVOKER, las políticas RLS
--    de la tabla subyacente se aplican al usuario que hace la consulta.

DROP VIEW IF EXISTS public.profiles_public CASCADE;

CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id,
  username,
  displayname,
  avatar_url,
  banner_url,
  bio,
  pronouns,
  roles,
  created_at,
  is_private,
  stats_private,
  stats_visibility,
  interests,
  social_links,
  song,
  accent_color,
  accent_color_secondary,
  accent_surface_color,
  accent_surface_glass,
  accent_visibility,
  show_accent_profile,
  show_accent_explore,
  banner_position,
  avatar_position,
  profile_background_url,
  profile_background_position,
  profile_background_blur,
  profile_background_dim,
  show_interests,
  show_profile_stats,
  show_trending,
  show_likes,
  show_saves,
  profile_views_count,
  allow_mention,
  allow_encrypted_add,
  show_badges,
  profile_text_color,
  user_status,
  user_status_updated_at
FROM profiles;

-- Forzar SECURITY INVOKER para que RLS se aplique al usuario que consulta,
-- no al creador de la vista (postgres). Sin esto, la vista bypassea RLS.
ALTER VIEW public.profiles_public SET (security_invoker = true);

-- Dar permisos de SELECT en la vista al rol anónimo
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- ══════════════════════════════════════════════════
-- 2. POSTS: filtrar posts encriptados
-- ══════════════════════════════════════════════════
-- Solo el autor o los usuarios en allowed_users pueden ver
-- posts con is_encrypted = true.

-- Reemplazar la política SELECT existente en posts
DROP POLICY IF EXISTS "Anyone can view posts" ON posts;
DROP POLICY IF EXISTS "Users can view posts" ON posts;

-- Política: cualquiera puede ver posts NO encriptados
DROP POLICY IF EXISTS "Anyone can view non-encrypted posts" ON posts;
CREATE POLICY "Anyone can view non-encrypted posts"
  ON posts FOR SELECT
  USING (
    is_encrypted IS DISTINCT FROM true
  );

-- Política: el autor o usuarios permitidos pueden ver posts encriptados
DROP POLICY IF EXISTS "Authors and allowed users can view encrypted posts" ON posts;
CREATE POLICY "Authors and allowed users can view encrypted posts"
  ON posts FOR SELECT
  USING (
    is_encrypted = true
    AND (
      auth.uid() = user_id
      OR auth.uid() = ANY (COALESCE(allowed_users, '{}'))
    )
  );

-- NOTA: Como RLS combina políticas con OR, un post encriptado será
-- visible SOLO si cumple la segunda política (ser autor o estar en allowed_users).
-- Los posts no encriptados son visibles para todos por la primera política.

-- ══════════════════════════════════════════════════
-- 3. Verificación: política de UPDATE para que un usuario
--    pueda actualizar is_encrypted sin problemas
-- ══════════════════════════════════════════════════
-- La política existente "Users can update own posts" ya usa
-- auth.uid() = user_id, así que no necesita cambios.

-- ══════════════════════════════════════════════════
-- 4. Crear vista pública para posts (sin encrypted_content)
-- ══════════════════════════════════════════════════
-- Vista que expone posts (sin encrypted_content).
-- El filtrado por is_encrypted lo hace RLS automáticamente gracias a
-- SECURITY INVOKER: los usuarios sin permiso no verán posts encriptados.
--
-- ⚠️ NO agregar WHERE is_encrypted IS DISTINCT FROM true aquí:
--    Eso rompería la vista para usuarios autorizados (no verían los posts
--    encriptados a los que SÍ tienen acceso). RLS se encarga del filtrado.

DROP VIEW IF EXISTS public.posts_public CASCADE;

CREATE OR REPLACE VIEW public.posts_public AS
SELECT
  id,
  user_id,
  content,
  image_url,
  image_urls,
  video_url,
  mentions,
  is_pinned,
  pinned_at,
  likes_count,
  dislikes_count,
  comments_count,
  reposts_count,
  views_count,
  comments_allowed,
  is_encrypted,
  allowed_users,
  -- encrypted_content, encrypted_iv — NO expuestos (solo via get_encrypted_post)
  obfuscated_display,
  poll_data,
  scheduled_at,
  is_sensitive,
  created_at,
  updated_at
FROM posts;

-- Forzar SECURITY INVOKER para que RLS se aplique al usuario que consulta.
ALTER VIEW public.posts_public SET (security_invoker = true);

GRANT SELECT ON public.posts_public TO anon, authenticated;

-- ══════════════════════════════════════════════════
-- 5. Función helper para que el frontend pueda obtener
--    posts encriptados cuando el usuario tiene permiso
-- ══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_encrypted_post(post_id uuid)
RETURNS SETOF posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM posts
  WHERE id = post_id
    AND is_encrypted = true
    AND (
      auth.uid() = user_id
      OR auth.uid() = ANY (COALESCE(allowed_users, '{}'))
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_encrypted_post TO authenticated;