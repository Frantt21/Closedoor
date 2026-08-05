-- ==============================================
-- Migration 061: Fix get_trending_words column name
-- ==============================================
-- La migración 058 usó "usage_count" pero la columna real es "use_count".
-- Esta migración corrige la función get_trending_words y bump_hashtag_usage.
-- ==============================================

-- ── bump_hashtag_usage: corregir nombre de columna ──
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


-- ── get_trending_words: corregir nombre de columna ──
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
