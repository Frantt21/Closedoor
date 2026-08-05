-- ==============================================
-- Migration 055: Harden RLS on all exposed tables
-- ==============================================
-- Auditoría en vivo (anon key, sin sesión) reveló:
--
-- 🔴 likes:         SIN RLS → 10+ filas con user_ids + post_ids
-- 🔴 comments:      SIN RLS → contenido + user_ids expuestos
-- 🔴 follows:       SIN RLS → grafo social completo expuesto
-- 🟡 reposts:       Solo INSERT policy → SELECT libre
-- 🟡 dislikes:      "Anyone can read" → user_ids expuestos
-- 🟡 comment_likes: "Anyone can view" → user_ids expuestos
-- 🟡 comment_dislikes: "Anyone can view" → user_ids expuestos
-- 🟡 posts_public:  Incluye allowed_users (debería ocultarse)
-- 🟡 posts (raw):   SELECT accesible con anon (debería ser solo la vista)
-- 🟡 profiles(raw): SELECT accesible con anon (debería ser solo la vista)
-- ==============================================


-- ════════════════════════════════════════════════
-- 1. LIKES — Enable RLS + policies
-- ════════════════════════════════════════════════
-- Likes revelan el grafo social. Solo usuarios autenticados
-- pueden ver quién dio like (para mostrar "te gustó" y contar).

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas existentes por si acaso
DROP POLICY IF EXISTS "Authenticated users can view likes" ON public.likes;
DROP POLICY IF EXISTS "Users can insert their own likes" ON public.likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON public.likes;

-- SELECT: solo autenticados (ocultar de anon)
CREATE POLICY "Authenticated users can view likes"
  ON public.likes FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: solo el propio usuario
CREATE POLICY "Users can insert their own likes"
  ON public.likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- DELETE: solo el propio usuario
CREATE POLICY "Users can delete their own likes"
  ON public.likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════
-- 2. COMMENTS — Enable RLS + policies
-- ════════════════════════════════════════════════
-- Comments son contenido público (se muestran en posts),
-- pero escritura solo para autenticados.

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
DROP POLICY IF EXISTS "Users can create comments" ON public.comments;
DROP POLICY IF EXISTS "Users can update own comments" ON public.comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
DROP POLICY IF EXISTS "Post owners can delete comments on their posts" ON public.comments;

-- SELECT: todos pueden ver comentarios (contenido público)
CREATE POLICY "Comments are viewable by everyone"
  ON public.comments FOR SELECT
  USING (true);

-- INSERT: solo autenticados, user_id = auth.uid()
CREATE POLICY "Users can create comments"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: solo el autor del comentario
CREATE POLICY "Users can update own comments"
  ON public.comments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: autor del comentario O dueño del post
CREATE POLICY "Users can delete own comments"
  ON public.comments FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = comments.post_id
        AND p.user_id = auth.uid()
    )
  );


-- ════════════════════════════════════════════════
-- 3. FOLLOWS — Enable RLS + policies
-- ════════════════════════════════════════════════
-- El grafo social (quién sigue a quién) es privado.
-- Solo los involucrados pueden ver la relación.

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own follows" ON public.follows;
DROP POLICY IF EXISTS "Users can follow others" ON public.follows;
DROP POLICY IF EXISTS "Users can unfollow others" ON public.follows;

-- SELECT: solo los involucrados (follower o following)
CREATE POLICY "Users can view own follows"
  ON public.follows FOR SELECT
  TO authenticated
  USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
  );

-- INSERT: solo el propio usuario como follower
CREATE POLICY "Users can follow others"
  ON public.follows FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

-- DELETE: solo el propio usuario como follower
CREATE POLICY "Users can unfollow others"
  ON public.follows FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);


-- ════════════════════════════════════════════════
-- 4. REPOSTS — Add SELECT restriction
-- ════════════════════════════════════════════════
-- Ya tiene INSERT policy (011). Falta SELECT restriction.

DROP POLICY IF EXISTS "Authenticated users can view reposts" ON public.reposts;
DROP POLICY IF EXISTS "Users can view own reposts" ON public.reposts;

-- SELECT: solo autenticados (ocultar de anon)
CREATE POLICY "Authenticated users can view reposts"
  ON public.reposts FOR SELECT
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════
-- 5. DISLIKES — Restrict SELECT to authenticated
-- ════════════════════════════════════════════════
-- Actualmente "Anyone can read dislikes" — ocultar de anon.

DROP POLICY IF EXISTS "Anyone can read dislikes" ON public.dislikes;

CREATE POLICY "Authenticated users can view dislikes"
  ON public.dislikes FOR SELECT
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════
-- 6. COMMENT_LIKES — Restrict SELECT to authenticated
-- ════════════════════════════════════════════════
-- Actualmente "Anyone can view" — ocultar de anon.

DROP POLICY IF EXISTS "Anyone can view likes" ON public.comment_likes;

CREATE POLICY "Authenticated users can view comment likes"
  ON public.comment_likes FOR SELECT
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════
-- 7. COMMENT_DISLIKES — Restrict SELECT to authenticated
-- ════════════════════════════════════════════════
-- Actualmente "Anyone can view dislikes" — ocultar de anon.

DROP POLICY IF EXISTS "Anyone can view dislikes" ON public.comment_dislikes;

CREATE POLICY "Authenticated users can view comment dislikes"
  ON public.comment_dislikes FOR SELECT
  TO authenticated
  USING (true);


-- ════════════════════════════════════════════════
-- 8. posts_public VIEW — Remove allowed_users
-- ════════════════════════════════════════════════
-- La columna allowed_users no debería estar en la vista pública.
-- Solo se necesita internamente para RLS de posts encriptados.

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
  -- allowed_users — REMOVIDO (no expuesto en la vista pública)
  obfuscated_display,
  poll_data,
  scheduled_at,
  is_sensitive,
  created_at,
  updated_at
FROM posts;

ALTER VIEW public.posts_public SET (security_invoker = true);

GRANT SELECT ON public.posts_public TO anon, authenticated;


-- ════════════════════════════════════════════════
-- 9. REVOKE raw tables from anon
-- ════════════════════════════════════════════════
-- Forzar que el acceso sea solo a través de las vistas
-- (posts_public y profiles_public).

REVOKE SELECT ON public.posts FROM anon;
REVOKE SELECT ON public.profiles FROM anon;


-- ════════════════════════════════════════════════
-- 10. Notas de impacto
-- ════════════════════════════════════════════════
-- Frontend:
--   - likes/reposts/dislikes: ya usa supabase.auth.getUser()
--     antes de consultar, así que las queries van con Bearer token.
--     Los contadores (likes_count, etc.) están denormalizados
--     en posts y no necesitan RLS de likes.
--   - comments: el SELECT público no cambia nada para el frontend.
--   - follows: el frontend solo consulta follows del propio usuario
--     (para botones de follow), así que la restricción no lo afecta.
--   - posts_public sin allowed_users: el frontend no consulta
--     allowed_users de la vista (solo lo hace via get_encrypted_post).
--   - REVOKE en posts/profiles: el frontend ya usa las vistas
--     (posts_public, profiles_public) desde la migración 051.
