-- Add shared_post_id column to messages table for sharing posts in chat
ALTER TABLE messages ADD COLUMN IF NOT EXISTS shared_post_id uuid REFERENCES posts(id) ON DELETE SET NULL;
