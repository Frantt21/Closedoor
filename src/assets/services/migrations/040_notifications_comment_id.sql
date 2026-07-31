-- ==============================================
-- Migration 040: comment_id en notifications
-- para deep-link a un comentario específico
-- ==============================================

-- Columna para guardar el comentario específico de la notificación
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES comments(id) ON DELETE CASCADE;

-- ==============================================
-- Actualizar notify_comment() para incluir comment_id
-- (nuevo comentario en tu post)
-- ==============================================
CREATE OR REPLACE FUNCTION notify_comment()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  -- Obtener el dueño del post
  SELECT user_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  -- No notificar si el usuario comenta su propio post
  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_id, comment_id)
    VALUES (post_owner_id, NEW.user_id, 'comment', NEW.post_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- Actualizar notify_comment_like() para incluir comment_id
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
    INSERT INTO notifications (user_id, actor_id, type, reference_id, comment_id)
    VALUES (comment_owner_id, NEW.user_id, 'comment_like', comment_post_id, NEW.comment_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
