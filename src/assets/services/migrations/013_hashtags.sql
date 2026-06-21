-- Migration 013: Hashtags for trending topics
-- Run this in your Supabase SQL Editor

-- ── Hashtags table ──
CREATE TABLE IF NOT EXISTS hashtags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  use_count INTEGER DEFAULT 1
);

-- ── Post-Hashtag junction table ──
CREATE TABLE IF NOT EXISTS post_hashtags (
  id BIGSERIAL PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  hashtag_id BIGINT REFERENCES hashtags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, hashtag_id)
);

-- Index for faster trending queries
CREATE INDEX IF NOT EXISTS idx_hashtags_use_count ON hashtags(use_count DESC);
CREATE INDEX IF NOT EXISTS idx_hashtags_last_used ON hashtags(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_hashtags_post_id ON post_hashtags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_hashtags_hashtag_id ON post_hashtags(hashtag_id);

-- ── RLS Policies ──
ALTER TABLE hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_hashtags ENABLE ROW LEVEL SECURITY;

-- Hashtags: anyone can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Anyone can read hashtags' AND tablename = 'hashtags'
  ) THEN
    CREATE POLICY "Anyone can read hashtags" ON hashtags
      FOR SELECT USING (true);
  END IF;
END
$$;

-- Post_hashtags: anyone can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Anyone can read post_hashtags' AND tablename = 'post_hashtags'
  ) THEN
    CREATE POLICY "Anyone can read post_hashtags" ON post_hashtags
      FOR SELECT USING (true);
  END IF;
END
$$;

-- Post_hashtags: authenticated users can insert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Authenticated users can insert post_hashtags' AND tablename = 'post_hashtags'
  ) THEN
    CREATE POLICY "Authenticated users can insert post_hashtags" ON post_hashtags
      FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
END
$$;

-- Add to Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'hashtags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE hashtags;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'post_hashtags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE post_hashtags;
  END IF;
END
$$;

-- ── Helper function: bump hashtag usage ──
CREATE OR REPLACE FUNCTION bump_hashtag_usage(p_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  h_id BIGINT;
BEGIN
  INSERT INTO hashtags (name, use_count, last_used_at)
  VALUES (LOWER(p_name), 1, NOW())
  ON CONFLICT (name) DO UPDATE SET
    use_count = hashtags.use_count + 1,
    last_used_at = NOW()
  RETURNING id INTO h_id;
  RETURN h_id;
END;
$$;

-- ── Trigger: clean up post_hashtags when a post is deleted ──
CREATE OR REPLACE FUNCTION cleanup_post_hashtags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Decrease use_count for each hashtag in the deleted post
  UPDATE hashtags h
  SET use_count = GREATEST(use_count - 1, 0)
  FROM post_hashtags ph
  WHERE ph.hashtag_id = h.id AND ph.post_id = OLD.id;

  -- Delete orphaned hashtags (use_count = 0)
  DELETE FROM hashtags WHERE use_count <= 0;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_post_hashtags ON posts;
CREATE TRIGGER trg_cleanup_post_hashtags
  AFTER DELETE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_post_hashtags();
