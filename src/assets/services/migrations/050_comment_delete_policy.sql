-- ─────────────────────────────────────────────────────────────────────────────
-- 050_comment_delete_policy.sql
-- Permite que el DUEÑO DEL POST borre comentarios en su propio post.
--
-- Contexto: la política existente "Users can delete own comments" solo permite
-- borrar al AUTOR del comentario (auth.uid() = user_id). Cuando el dueño del
-- post intentaba borrar un comentario ajeno, RLS filtraba el DELETE en
-- silencio (0 filas, sin error) → el frontend lo borraba localmente pero en
-- la DB nunca se eliminaba.
--
-- Las políticas RLS de DELETE se combinan con OR, así que esta política
-- adicional NO rompe la del autor: cualquiera de las dos que permita, gana.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Post owners can delete comments on their posts" ON public.comments;

CREATE POLICY "Post owners can delete comments on their posts"
  ON public.comments
  FOR DELETE
  TO authenticated
  USING (
    -- El dueño del post puede borrar cualquier comentario de su post
    auth.uid() IN (
      SELECT p.user_id
      FROM public.posts p
      WHERE p.id = comments.post_id
    )
  );
