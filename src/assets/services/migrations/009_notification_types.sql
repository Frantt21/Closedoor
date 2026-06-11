-- ==============================================
-- Migration 009: Agregar nuevos tipos de notificación
-- ==============================================
-- Agrega follow_request_accepted y follow_request_rejected
-- al CHECK constraint de notifications.type

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
    'mention'
  ));
