-- ==============================================
-- Migration 002: Sistema de notificaciones
-- ==============================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('follow', 'like', 'comment', 'follow_request')),
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para listar notificaciones de un usuario (más recientes primero)
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- Índice parcial para contar no leídas rápido
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read)
  WHERE is_read = FALSE;

-- Habilitar Realtime para notificaciones
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- ==============================================
-- EJEMPLOS DE CONSULTA:
-- ==============================================
-- Obtener notificaciones:
--   SELECT n.*, p.username, p.avatar_url
--   FROM notifications n
--   JOIN profiles p ON p.id = n.actor_id
--   WHERE n.user_id = 'mi-id'
--   ORDER BY n.created_at DESC;
--
-- Marcar una como leída:
--   UPDATE notifications SET is_read = TRUE WHERE id = 'notif-id';
--
-- Marcar todas como leídas:
--   UPDATE notifications SET is_read = TRUE
--   WHERE user_id = 'mi-id' AND is_read = FALSE;
--
-- Contar no leídas:
--   SELECT COUNT(*) FROM notifications
--   WHERE user_id = 'mi-id' AND is_read = FALSE;
-- ==============================================
