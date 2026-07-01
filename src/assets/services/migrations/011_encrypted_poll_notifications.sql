-- ==============================================
-- Migration 011: Notificaciones de posts encriptados y votos en polls
-- ==============================================
-- Agrega 'encrypted_add' y 'poll_vote' al CHECK constraint de notifications.type

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
    'poll_vote'
  ));
