-- =============================================
-- Migration 063: FINAL fix for get_trending_words
-- =============================================
-- The root cause: migration 058 recreated these functions using
-- "usage_count" but the actual column in the hashtags table is "use_count".
-- This migration runs AFTER 058 and permanently fixes both functions.
-- =============================================

-- Step 1: Ensure the column is named correctly (handle both cases)
DO $$
BEGIN
  -- If usage_count exists AND use_count doesn't → rename
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'usage_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'use_count'
  ) THEN
    ALTER TABLE hashtags RENAME COLUMN usage_count TO use_count;
    RAISE NOTICE 'Renamed usage_count → use_count';
  END IF;

  -- If NEITHER exists → create use_count
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'use_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hashtags' AND column_name = 'usage_count'
  ) THEN
    ALTER TABLE hashtags ADD COLUMN use_count INTEGER DEFAULT 1;
    RAISE NOTICE 'Added missing use_count column';
  END IF;
END $$;

-- Step 2: Force-drop BOTH functions (ignore errors if they don't exist)
DROP FUNCTION IF EXISTS public.get_trending_words(INT, INT);
DROP FUNCTION IF EXISTS public.bump_hashtag_usage(TEXT);

-- Step 3: Recreate get_trending_words with CORRECT column name
CREATE OR REPLACE FUNCTION public.get_trending_words(
  limit_count INT DEFAULT 8,
  hours_back INT DEFAULT 24
)
RETURNS TABLE(word TEXT, frequency BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT h.name AS word, h.use_count::BIGINT AS frequency
  FROM hashtags h
  WHERE h.last_used_at > NOW() - (hours_back || ' hours')::interval
    AND h.name NOT LIKE '__sec_test_%'
  ORDER BY h.use_count DESC
  LIMIT limit_count;
END;
$$;

-- Step 4: Recreate bump_hashtag_usage with CORRECT column name
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

-- Step 5: Verify (optional — run manually to confirm)
-- SELECT * FROM get_trending_words(5, 24);
-- SELECT * FROM information_schema.columns
--   WHERE table_name = 'hashtags' AND column_name IN ('use_count', 'usage_count');
