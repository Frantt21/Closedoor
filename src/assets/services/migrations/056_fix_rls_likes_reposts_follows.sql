-- ==============================================
-- Migration 056: Force-fix RLS on social tables
-- ==============================================
-- La migración 055 creó policies pero RLS no surtió
-- efecto en likes/reposts/comment_likes (anon sigue
-- leyendo). Esta migración usa REVOKE + FORCE RLS
-- como defensa en profundidad.
-- ==============================================


-- ════════════════════════════════════════════════
-- DEFENSA: REVOKE SELECT de anon en TODAS las
-- tablas de interacción social.
-- Esto funciona INDEPENDIENTEMENTE de las policies:
-- si anon no tiene GRANT, no puede leer aunque
-- RLS esté deshabilitado o las policies fallen.
-- ════════════════════════════════════════════════

REVOKE SELECT ON public.likes FROM anon;
REVOKE SELECT ON public.reposts FROM anon;
REVOKE SELECT ON public.follows FROM anon;
REVOKE SELECT ON public.comment_likes FROM anon;
REVOKE SELECT ON public.dislikes FROM anon;
REVOKE SELECT ON public.comment_dislikes FROM anon;


-- ════════════════════════════════════════════════
-- Asegurar que RLS esté habilitado en TODAS las tablas
-- (por si alguna no lo tenía de migraciones anteriores)
-- ════════════════════════════════════════════════

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dislikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_dislikes ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════
-- FORCE RLS: asegurar que incluso el table owner
-- esté sujeto a RLS (belt and suspenders)
-- ════════════════════════════════════════════════

ALTER TABLE public.likes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reposts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.follows FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dislikes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.comment_dislikes FORCE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════
-- DROP + recrear policies limpias para likes
-- (por si las de 055 no se crearon)
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view likes" ON public.likes;
DROP POLICY IF EXISTS "Users can insert their own likes" ON public.likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON public.likes;

CREATE POLICY "Authenticated users can view likes"
  ON public.likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own likes"
  ON public.likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own likes"
  ON public.likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════
-- reposts: DROP + recrear
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view reposts" ON public.reposts;
DROP POLICY IF EXISTS "Users can create reposts" ON public.reposts;

CREATE POLICY "Authenticated users can view reposts"
  ON public.reposts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create reposts"
  ON public.reposts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);


-- ════════════════════════════════════════════════
-- follows: DROP + recrear
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Users can view own follows" ON public.follows;
DROP POLICY IF EXISTS "Users can follow others" ON public.follows;
DROP POLICY IF EXISTS "Users can unfollow others" ON public.follows;
DROP POLICY IF EXISTS "Users can accept follow requests" ON public.follows;
DROP POLICY IF EXISTS "Users can reject follow requests" ON public.follows;

CREATE POLICY "Users can view own follows"
  ON public.follows FOR SELECT
  TO authenticated
  USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
  );

CREATE POLICY "Users can follow others"
  ON public.follows FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow others"
  ON public.follows FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);


-- ════════════════════════════════════════════════
-- comment_likes: DROP + recrear
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view comment likes" ON public.comment_likes;
DROP POLICY IF EXISTS "Anyone can view likes" ON public.comment_likes;
DROP POLICY IF EXISTS "Users can manage their own likes" ON public.comment_likes;

CREATE POLICY "Authenticated users can view comment likes"
  ON public.comment_likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage their own comment likes"
  ON public.comment_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comment likes"
  ON public.comment_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════
-- dislikes: DROP + recrear
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view dislikes" ON public.dislikes;
DROP POLICY IF EXISTS "Anyone can read dislikes" ON public.dislikes;
DROP POLICY IF EXISTS "Users can insert their own dislikes" ON public.dislikes;
DROP POLICY IF EXISTS "Users can delete their own dislikes" ON public.dislikes;

CREATE POLICY "Authenticated users can view dislikes"
  ON public.dislikes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert their own dislikes"
  ON public.dislikes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dislikes"
  ON public.dislikes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════
-- comment_dislikes: DROP + recrear
-- ════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can view comment dislikes" ON public.comment_dislikes;
DROP POLICY IF EXISTS "Anyone can view dislikes" ON public.comment_dislikes;
DROP POLICY IF EXISTS "Users can manage their own dislikes" ON public.comment_dislikes;

CREATE POLICY "Authenticated users can view comment dislikes"
  ON public.comment_dislikes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage their own comment dislikes"
  ON public.comment_dislikes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comment dislikes"
  ON public.comment_dislikes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
