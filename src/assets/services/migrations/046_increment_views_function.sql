-- ─────────────────────────────────────────────
-- Atomic increment for post views_count
-- Elimina la race condition del SELECT+UPDATE
-- en trackPostView() del cliente
-- ─────────────────────────────────────────────

-- Create the function (idempotent: OR REPLACE)
CREATE OR REPLACE FUNCTION increment_post_views(post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts
  SET views_count = views_count + 1
  WHERE id = post_id;
END;
$$;

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION increment_post_views TO authenticated;
GRANT EXECUTE ON FUNCTION increment_post_views TO anon;
