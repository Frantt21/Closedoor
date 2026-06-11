-- ==============================================
-- Migration 005: Fix counter triggers + comment_likes_count
-- ==============================================
-- Ejecutar en el SQL Editor de Supabase.
-- Requiere migraciones 002, 003, 004 ejecutadas previamente.

-- ==============================================
-- 1. Recrear counter triggers con SECURITY DEFINER
--    (los originales no tenían SECURITY DEFINER, lo que bloqueaba
--     la actualización de contadores cuando otro usuario interactuaba)
-- ==============================================

-- Eliminar triggers existentes
DROP TRIGGER IF EXISTS on_like_insert ON likes;
DROP TRIGGER IF EXISTS on_like_delete ON likes;
DROP TRIGGER IF EXISTS on_comment_insert ON comments;
DROP TRIGGER IF EXISTS on_comment_delete ON comments;
DROP TRIGGER IF EXISTS on_repost_insert ON reposts;
DROP TRIGGER IF EXISTS on_repost_delete ON reposts;

-- Eliminar funciones existentes
DROP FUNCTION IF EXISTS increment_likes_count();
DROP FUNCTION IF EXISTS decrement_likes_count();
DROP FUNCTION IF EXISTS increment_comments_count();
DROP FUNCTION IF EXISTS decrement_comments_count();
DROP FUNCTION IF EXISTS increment_reposts_count();
DROP FUNCTION IF EXISTS decrement_reposts_count();

-- ========== LIKES COUNTER ==========
CREATE OR REPLACE FUNCTION increment_likes_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_likes_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_like_insert
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION increment_likes_count();

CREATE TRIGGER on_like_delete
  AFTER DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION decrement_likes_count();

-- ========== COMMENTS COUNTER ==========
CREATE OR REPLACE FUNCTION increment_comments_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_comments_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_comment_insert
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION increment_comments_count();

CREATE TRIGGER on_comment_delete
  AFTER DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION decrement_comments_count();

-- ========== REPOSTS COUNTER ==========
CREATE OR REPLACE FUNCTION increment_reposts_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_reposts_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_repost_insert
  AFTER INSERT ON reposts
  FOR EACH ROW EXECUTE FUNCTION increment_reposts_count();

CREATE TRIGGER on_repost_delete
  AFTER DELETE ON reposts
  FOR EACH ROW EXECUTE FUNCTION decrement_reposts_count();

-- ==============================================
-- 2. Agregar comment_likes_count a comments table
-- ==============================================
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS comment_likes_count INTEGER DEFAULT 0;

-- ==============================================
-- 3. Counter triggers para comment_likes
-- ==============================================

CREATE OR REPLACE FUNCTION increment_comment_likes_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments SET comment_likes_count = comment_likes_count + 1 WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_comment_likes_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  UPDATE comments SET comment_likes_count = GREATEST(comment_likes_count - 1, 0) WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_comment_like_insert ON comment_likes;
CREATE TRIGGER on_comment_like_insert
  AFTER INSERT ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION increment_comment_likes_count();

DROP TRIGGER IF EXISTS on_comment_like_delete ON comment_likes;
CREATE TRIGGER on_comment_like_delete
  AFTER DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION decrement_comment_likes_count();

-- ==============================================
-- 4. Agregar FK constraint para reference_id → posts(id)
--    (necesario para que Supabase resuelva post:reference_id en selects)
-- ==============================================
-- Limpiar reference_ids huérfanos antes de crear la FK
UPDATE notifications SET reference_id = NULL
WHERE reference_id IS NOT NULL
  AND reference_id NOT IN (SELECT id FROM posts);

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS fk_notifications_reference;

ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_reference
  FOREIGN KEY (reference_id) REFERENCES posts(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE notifications VALIDATE CONSTRAINT fk_notifications_reference;

-- ==============================================
-- 5. Agregar 'comment_like' al CHECK de notifications
-- ==============================================
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow', 'like', 'comment', 'follow_request', 'repost', 'comment_like'));

-- ==============================================
-- 6. Función: notificar comment_like
-- ==============================================

-- ==============================================
-- 6. Función: notificar comment_like
-- ==============================================

CREATE OR REPLACE FUNCTION notify_comment_like()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  comment_owner_id UUID;
  comment_post_id UUID;
BEGIN
  -- Obtener dueño del comentario y el post al que pertenece
  SELECT user_id, post_id INTO comment_owner_id, comment_post_id
  FROM comments WHERE id = NEW.comment_id;

  -- No notificar si el usuario se da like a su propio comentario
  IF comment_owner_id IS NOT NULL AND comment_owner_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_id)
    VALUES (comment_owner_id, NEW.user_id, 'comment_like', comment_post_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_notify_comment_like ON comment_likes;
CREATE TRIGGER on_notify_comment_like
  AFTER INSERT ON comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment_like();
