-- ==============================================
-- Migration 036: Notificaciones de dislikes
-- ==============================================
-- Agrega 'dislike' al CHECK constraint de notifications.type
-- y crea el trigger para notificar al dueño del post cuando
-- alguien le da dislike a su post.

-- ==============================================
-- 1. Agregar 'dislike' al CHECK constraint
-- ==============================================
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow',
    'follow_request',
    'follow_request_accepted',
    'follow_request_rejected',
    'like',
    'comment',
    'repost',
    'comment_like',
    'mention',
    'encrypted_add',
    'poll_vote',
    'dislike'
  ));

-- ==============================================
-- 2. Función: notificar dislike
-- ==============================================
CREATE OR REPLACE FUNCTION notify_dislike()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  -- Obtener el dueño del post
  SELECT user_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  -- No notificar si el usuario se da dislike a sí mismo
  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_id)
    VALUES (post_owner_id, NEW.user_id, 'dislike', NEW.post_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- 3. Crear el trigger
-- ==============================================
DROP TRIGGER IF EXISTS on_notify_dislike ON dislikes;
CREATE TRIGGER on_notify_dislike
  AFTER INSERT ON dislikes
  FOR EACH ROW
  EXECUTE FUNCTION notify_dislike();
