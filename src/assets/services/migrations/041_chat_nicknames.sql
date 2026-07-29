-- 041_chat_nicknames.sql
-- Per-user nicknames for chat conversations.
-- User A sets a nickname for User B; only User A sees it.
-- The view replaces displayname/username in Chat.jsx when a nickname is set.

CREATE TABLE IF NOT EXISTS chat_nicknames (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (char_length(nickname) > 0 AND char_length(nickname) <= 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_user_id)
);

-- Enable RLS
ALTER TABLE chat_nicknames ENABLE ROW LEVEL SECURITY;

-- Users can manage their own nicknames
CREATE POLICY "Users can manage their own nicknames"
  ON chat_nicknames
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can see nicknames others set for them (for potential future use)
CREATE POLICY "Users can see nicknames set for them"
  ON chat_nicknames
  FOR SELECT
  USING (target_user_id = auth.uid());

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE chat_nicknames;
