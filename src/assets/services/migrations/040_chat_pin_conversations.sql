-- ════════════════════════════════════════════════════════
-- Migration 040: Add per-user pinning to chat_participants
-- ════════════════════════════════════════════════════════
--
-- Allows users to pin up to 3 conversations to the top of their
-- chat list, similar to pinned posts on a profile.
-- The pin is per-user (stored in chat_participants, not conversations),
-- so User A can pin without affecting User B's view.
--
-- pinned_at is used for ordering: oldest pinned_at = first position.
--

ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
