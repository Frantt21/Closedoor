-- Migration 020: Blocks table for user blocking functionality
-- Permite a los usuarios bloquear a otros usuarios.
-- Run this in your Supabase SQL Editor

-- Create blocks table
CREATE TABLE IF NOT EXISTS blocks (
  id BIGSERIAL PRIMARY KEY,
  blocker_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Prevent duplicate blocks
  UNIQUE(blocker_id, blocked_id),
  -- Prevent self-block
  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

-- Enable RLS
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

-- Policies:
-- 1. Users can block others (insert their own blocks)
CREATE POLICY blocks_insert_policy ON blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

-- 2. Users can unblock (delete their own blocks)
CREATE POLICY blocks_delete_policy ON blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- 3. Users can see who they've blocked
CREATE POLICY blocks_select_own_policy ON blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

-- 4. Blocked users can see they've been blocked (to show "blocked by" status)
CREATE POLICY blocks_select_blocked_policy ON blocks
  FOR SELECT
  TO authenticated
  USING (blocked_id = auth.uid());

COMMENT ON TABLE blocks IS 'Stores user block relationships';
COMMENT ON COLUMN blocks.blocker_id IS 'User who initiated the block';
COMMENT ON COLUMN blocks.blocked_id IS 'User who is blocked';
