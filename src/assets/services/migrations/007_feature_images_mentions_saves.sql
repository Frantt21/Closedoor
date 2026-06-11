-- ==============================================
-- Migration 007: Imágenes múltiples, @menciones y guardar posts
-- ==============================================

-- ==============================================
-- 1. Agregar columna image_urls (JSONB) a posts
-- ==============================================
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

-- Migrar image_url existente al nuevo array
UPDATE posts
SET image_urls = jsonb_build_array(image_url)
WHERE image_url IS NOT NULL AND (image_urls IS NULL OR image_urls = '[]'::jsonb);

-- ==============================================
-- 2. Tabla: saved_posts (guardados/marcadores)
-- ==============================================
CREATE TABLE IF NOT EXISTS saved_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

-- Índice para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, created_at DESC);

-- Row Level Security
ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own saves' AND tablename = 'saved_posts') THEN
    CREATE POLICY "Users can view their own saves"
      ON saved_posts FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert their own saves' AND tablename = 'saved_posts') THEN
    CREATE POLICY "Users can insert their own saves"
      ON saved_posts FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete their own saves' AND tablename = 'saved_posts') THEN
    CREATE POLICY "Users can delete their own saves"
      ON saved_posts FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Agregar a Realtime publication (si no está ya)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'saved_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE saved_posts;
  END IF;
END $$;

-- ==============================================
-- 3. Función para crear notificación de mención
--    (se llama desde el frontend al crear un post)
-- ==============================================
CREATE OR REPLACE FUNCTION create_mention_notification(
  p_actor_id UUID,
  p_user_id UUID,
  p_reference_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO notifications (actor_id, user_id, type, reference_id)
  VALUES (p_actor_id, p_user_id, 'mention', p_reference_id)
  ON CONFLICT DO NOTHING;
END;
$$;

-- ==============================================
-- 4. Agregar 'mention' al CHECK de notifications
-- ==============================================
DO $$
BEGIN
  -- Verificar si existe la constraint CHECK
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'notifications' AND constraint_type = 'CHECK'
    AND constraint_name = 'notifications_type_check'
  ) THEN
    -- No podemos modificar un CHECK directamente, así que lo recreamos
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('follow', 'follow_request', 'like', 'comment', 'repost', 'comment_like', 'mention'));
  END IF;
END $$;
