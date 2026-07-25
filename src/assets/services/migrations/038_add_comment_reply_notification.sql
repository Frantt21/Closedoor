-- ════════════════════════════════════════════════════════
-- Migration 038: Add 'comment_reply' notification type
-- ════════════════════════════════════════════════════════

-- Add comment_reply to the CHECK constraint for notifications.type
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY[
  'follow',
  'follow_request',
  'follow_request_accepted',
  'follow_request_rejected',
  'like',
  'dislike',
  'comment',
  'comment_like',
  'comment_mention',
  'comment_reply',
  'repost',
  'mention',
  'encrypted_add',
  'poll_vote'
]));
