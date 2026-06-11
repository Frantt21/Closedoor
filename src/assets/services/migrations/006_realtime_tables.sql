-- ==============================================
-- Migration 006: Add tables to Realtime publication
-- ==============================================
-- Necesario para que las suscripciones Realtime
-- funcionen en posts, reposts, comments, comment_likes.

DO $$
BEGIN
  -- posts
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE posts;
  END IF;

  -- reposts
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reposts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reposts;
  END IF;

  -- comments
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comments;
  END IF;

  -- comment_likes
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'comment_likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comment_likes;
  END IF;

  -- likes
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE likes;
  END IF;
END
$$;
