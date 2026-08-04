-- ==============================================
-- Migration 052: Fix posts_public view — add missing columns
-- ==============================================
-- La vista posts_public (creada en migration 051) no incluía
-- dislikes_count ni allowed_users, lo que causaba errores 400/42703
-- en el frontend al consultar la vista.
-- ==============================================

DROP VIEW IF EXISTS public.posts_public CASCADE;

CREATE OR REPLACE VIEW public.posts_public AS
SELECT
  id,
  user_id,
  content,
  image_url,
  image_urls,
  video_url,
  mentions,
  is_pinned,
  pinned_at,
  likes_count,
  dislikes_count,
  comments_count,
  reposts_count,
  views_count,
  comments_allowed,
  is_encrypted,
  allowed_users,
  -- encrypted_content, encrypted_iv — NO expuestos (solo via get_encrypted_post)
  obfuscated_display,
  poll_data,
  scheduled_at,
  is_sensitive,
  created_at,
  updated_at
FROM posts;

ALTER VIEW public.posts_public SET (security_invoker = true);

GRANT SELECT ON public.posts_public TO anon, authenticated;