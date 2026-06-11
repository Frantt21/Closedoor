-- ==============================================
-- Migration 004: Triggers automáticos de notificaciones
-- ==============================================
-- Ejecutar en orden dentro del SQL Editor de Supabase.
-- Ya debe existir la tabla notifications (migración 002).

-- ==============================================
-- 1. Añadir 'repost' al CHECK constraint existente
-- ==============================================
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow', 'like', 'comment', 'follow_request', 'repost'));

-- ==============================================
-- 2. RLS policies faltantes para notifications
-- ==============================================

-- Permitir SELECT (usuarios ven sus propias notificaciones)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Permitir INSERT desde triggers de base de datos
-- Nota: auth.uid() puede no estar disponible dentro de un trigger,
-- así que permitimos INSERT desde funciones con SECURITY DEFINER.
-- Esta policy permite el paso porque los triggers corren con
-- permisos del owner de la tabla.
-- Los triggers usan SECURITY DEFINER, así que bypassan RLS.
-- Esta política permite que el frontend cree notificaciones
-- solo cuando el usuario autenticado es el actor (no puede falsear).
CREATE POLICY "Users can create notifications as actor"
  ON notifications FOR INSERT
  WITH CHECK (auth.uid() = actor_id);

-- ==============================================
-- 3. Función: notificar like
-- ==============================================
CREATE OR REPLACE FUNCTION notify_like()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  -- Obtener el dueño del post
  SELECT user_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  -- No notificar si el usuario se da like a sí mismo
  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_id)
    VALUES (post_owner_id, NEW.user_id, 'like', NEW.post_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- 4. Función: notificar comentario
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
    INSERT INTO notifications (user_id, actor_id, type, reference_id)
    VALUES (post_owner_id, NEW.user_id, 'comment', NEW.post_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- 5. Función: notificar repost
-- ==============================================
CREATE OR REPLACE FUNCTION notify_repost()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_id UUID;
BEGIN
  -- Obtener el dueño del post
  SELECT user_id INTO post_owner_id FROM posts WHERE id = NEW.post_id;

  -- No notificar si el usuario repostea su propio post
  IF post_owner_id IS NOT NULL AND post_owner_id != NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_id)
    VALUES (post_owner_id, NEW.user_id, 'repost', NEW.post_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================
-- 6. Crear los triggers
-- ==============================================

-- Trigger para likes
DROP TRIGGER IF EXISTS on_notify_like ON likes;
CREATE TRIGGER on_notify_like
  AFTER INSERT ON likes
  FOR EACH ROW
  EXECUTE FUNCTION notify_like();

-- Trigger para comentarios
DROP TRIGGER IF EXISTS on_notify_comment ON comments;
CREATE TRIGGER on_notify_comment
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_comment();

-- Trigger para reposts
DROP TRIGGER IF EXISTS on_notify_repost ON reposts;
CREATE TRIGGER on_notify_repost
  AFTER INSERT ON reposts
  FOR EACH ROW
  EXECUTE FUNCTION notify_repost();

-- ==============================================
-- 7. Asegurar que notifications esté en la publicación Realtime
--    (usamos DO block porque IF NOT EXISTS no es válido en ALTER PUBLICATION)
-- ==============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END
$$;
