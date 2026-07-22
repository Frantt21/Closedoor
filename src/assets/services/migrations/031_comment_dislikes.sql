-- ==============================================
-- Migration 031: Add comment_dislikes table
-- ==============================================
-- Allows users to dislike comments, similar to
-- comment_likes but for negative feedback.
-- ==============================================

CREATE TABLE IF NOT EXISTS comment_dislikes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, comment_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_comment_dislikes_user_id ON comment_dislikes(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_dislikes_comment_id ON comment_dislikes(comment_id);

-- Enable RLS
ALTER TABLE comment_dislikes ENABLE ROW LEVEL SECURITY;

-- Allow users to insert/delete their own dislikes
CREATE POLICY "Users can manage their own dislikes"
  ON comment_dislikes
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow everyone to read dislikes (for counts)
CREATE POLICY "Anyone can view dislikes"
  ON comment_dislikes
  FOR SELECT
  USING (true);

-- Add a dislikes_count column to comments table for efficient counting
-- Note: comment_likes already uses comment_likes_count, so we use comment_dislikes_count
ALTER TABLE comments ADD COLUMN IF NOT EXISTS comment_dislikes_count BIGINT NOT NULL DEFAULT 0;

-- Trigger to update comment_dislikes_count on insert/delete of dislikes
CREATE OR REPLACE FUNCTION update_comment_dislikes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments
    SET comment_dislikes_count = (
      SELECT COUNT(*) FROM comment_dislikes WHERE comment_id = NEW.comment_id
    )
    WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments
    SET comment_dislikes_count = (
      SELECT COUNT(*) FROM comment_dislikes WHERE comment_id = OLD.comment_id
    )
    WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_dislikes_insert ON comment_dislikes;
CREATE TRIGGER trg_comment_dislikes_insert
  AFTER INSERT ON comment_dislikes
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_dislikes_count();

DROP TRIGGER IF EXISTS trg_comment_dislikes_delete ON comment_dislikes;
CREATE TRIGGER trg_comment_dislikes_delete
  AFTER DELETE ON comment_dislikes
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_dislikes_count();
