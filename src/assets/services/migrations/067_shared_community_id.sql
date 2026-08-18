-- 067: Add shared_community_id to messages for community invite cards in chat
-- Similar to shared_post_id (migration 038), this allows sending community
-- invites as formatted cards in chat conversations.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS shared_community_id uuid REFERENCES communities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_shared_community ON messages(shared_community_id) WHERE shared_community_id IS NOT NULL;
