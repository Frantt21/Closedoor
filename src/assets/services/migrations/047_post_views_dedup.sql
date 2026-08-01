-- ─────────────────────────────────────────────
-- Post views deduplicadas por usuario (1 vista por usuario por post)
-- Reemplaza el dedup frágil por localStorage con una tabla server-side.
-- ─────────────────────────────────────────────

-- Tabla post_views: 1 fila por (usuario, post) → dedup real
CREATE TABLE IF NOT EXISTS post_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS post_views_post_id_idx ON post_views(post_id);
CREATE INDEX IF NOT EXISTS post_views_user_id_idx ON post_views(user_id);

ALTER TABLE post_views ENABLE ROW LEVEL SECURITY;

-- Los usuarios pueden leer sus propias vistas (el RPC es SECURITY DEFINER,
-- así que no necesita policies para insertar).
-- Idempotente: si la política ya existe (migración re-ejecutada), se recrea.
DROP POLICY IF EXISTS "post_views_select_own" ON post_views;
CREATE POLICY "post_views_select_own"
  ON post_views FOR SELECT
  USING (auth.uid() = user_id);

-- ── Backfill: usuarios que YA interactuaron (like, dislike, comentario,
-- guardado o repost) quedan marcados como vistos para no volver a contar. ──
INSERT INTO post_views (user_id, post_id)
SELECT DISTINCT user_id, post_id FROM likes
ON CONFLICT DO NOTHING;

INSERT INTO post_views (user_id, post_id)
SELECT DISTINCT user_id, post_id FROM dislikes
ON CONFLICT DO NOTHING;

INSERT INTO post_views (user_id, post_id)
SELECT DISTINCT user_id, post_id FROM comments
ON CONFLICT DO NOTHING;

INSERT INTO post_views (user_id, post_id)
SELECT DISTINCT user_id, post_id FROM saved_posts
ON CONFLICT DO NOTHING;

INSERT INTO post_views (user_id, post_id)
SELECT DISTINCT user_id, post_id FROM reposts
ON CONFLICT DO NOTHING;

-- ── RPC atómico: solo incrementa views_count si es la PRIMERA vista
-- de ese usuario en ese post (si la fila ya existe, no hace nada). ──
CREATE OR REPLACE FUNCTION increment_post_views(post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new BOOLEAN;
BEGIN
  -- Sin usuario identificable (anónimo) → no contar
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Insertar la vista; si ya existe (UNIQUE user_id+post_id) no se inserta nada
  INSERT INTO post_views (user_id, post_id)
  VALUES (v_user_id, post_id)
  ON CONFLICT (user_id, post_id) DO NOTHING
  RETURNING true INTO v_new;

  -- Solo si fue una fila nueva → incrementar el contador
  IF v_new THEN
    UPDATE posts
    SET views_count = views_count + 1
    WHERE id = post_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_post_views TO authenticated;
GRANT EXECUTE ON FUNCTION increment_post_views TO anon;

-- ⚠️ Para resetear los números inflados (vistas = usuarios distintos que
-- interactuaron), ejecuta por separado: 048_reset_inflated_views.sql
