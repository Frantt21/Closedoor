-- =============================================
-- Migration 062: Force fix get_trending_words
-- =============================================
-- Drop and recreate the function to guarantee correct column references.
-- The error "structure of query does not match function result type" means
-- the function body references a column that doesn't exist in the table.
-- =============================================

-- First, check and fix the column name if needed
DO $$
BEGIN
  -- If usage_count exists but use_count doesn't, rename it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'usage_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'use_count'
  ) THEN
    ALTER TABLE hashtags RENAME COLUMN usage_count TO use_count;
    RAISE NOTICE 'Renamed usage_count to use_count';
  END IF;
END $$;

-- Force drop and recreate get_trending_words
DROP FUNCTION IF EXISTS public.get_trending_words(INT, INT);

CREATE OR REPLACE FUNCTION public.get_trending_words(limit_count INT DEFAULT 8, hours_back INT DEFAULT 24)
RETURNS TABLE(word TEXT, frequency BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT h.name AS word, h.use_count AS frequency
  FROM hashtags h
  WHERE h.last_used_at > NOW() - (hours_back || ' hours')::interval
    AND h.name NOT LIKE '__sec_test_%'
  ORDER BY h.use_count DESC
  LIMIT limit_count;
END;
$$;

-- Force drop and recreate bump_hashtag_usage too
DROP FUNCTION IF EXISTS public.bump_hashtag_usage(TEXT);

CREATE OR REPLACE FUNCTION public.bump_hashtag_usage(p_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO hashtags (name, use_count, last_used_at)
  VALUES (lower(trim(p_name)), 1, NOW())
  ON CONFLICT (name) DO UPDATE
    SET use_count = hashtags.use_count + 1,
        last_used_at = NOW()
  RETURNING use_count INTO result;

  RETURN result;
END;
$$;

-- Verify: query the function to ensure it works
-- SELECT * FROM get_trending_words(5, 24);
