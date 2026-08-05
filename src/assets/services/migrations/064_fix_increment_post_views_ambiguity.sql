-- ==============================================
-- Migration 064: Fix increment_post_views ambiguity
-- ==============================================
-- La migración 058 recreó increment_post_views usando el nombre del parámetro
-- `post_id` junto a la columna post_views.post_id → ERROR al llamar al RPC:
--
--   column reference "post_id" is ambiguous
--
-- (mismo patrón que el fix de get_trending_words/bump_hashtag_usage en 063:
-- 058 sobreescribe funciones que otras migraciones ya habían corregido).
--
-- Fix: usar $1 para el valor y ON CONFLICT DO NOTHING SIN lista de columnas
-- (la versión corregida de 047_post_views_dedup.sql). Idempotente: se puede
-- ejecutar aunque 047 ya estuviera aplicada.
-- ==============================================

-- ── Asegurar la tabla post_views (por si 047 no se aplicó) ──
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

DROP POLICY IF EXISTS "post_views_select_own" ON post_views;
CREATE POLICY "post_views_select_own"
  ON post_views FOR SELECT
  USING (auth.uid() = user_id);

-- ── Backfill (idempotente): interacciones previas quedan marcadas como vistas ──
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

-- ── Función corregida: $1 evita la colisión con post_views.post_id ──
-- Solo incrementa views_count la PRIMERA vez que el usuario ve el post.
CREATE OR REPLACE FUNCTION public.increment_post_views(post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new BOOLEAN;
BEGIN
  -- Sin usuario identificable (anónimo) → no contar (no inflar contadores)
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- ⚠️ $1 (el parámetro) y ON CONFLICT DO NOTHING sin lista de columnas:
  -- el nombre `post_id` choca con la columna de post_views → ambiguous.
  INSERT INTO post_views (user_id, post_id)
  VALUES (v_user_id, $1)
  ON CONFLICT DO NOTHING
  RETURNING true INTO v_new;

  -- Solo si fue una fila nueva → incrementar el contador
  IF v_new THEN
    UPDATE posts
    SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = $1;
  END IF;
END;
$$;

-- CREATE OR REPLACE re-granta EXECUTE → re-aplicar la seguridad (solo authenticated)
REVOKE EXECUTE ON FUNCTION public.increment_post_views(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_post_views(uuid) TO authenticated;

-- ── Nota: si los contadores quedaron inflados por el bug, ejecuta por
-- separado 048_reset_inflated_views.sql para recalcularlos desde post_views. ──
