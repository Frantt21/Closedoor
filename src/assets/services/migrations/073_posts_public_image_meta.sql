-- ==============================================
-- Migration 073: posts_public view — exponer image_meta
-- ==============================================
-- La migración 072 añadió posts.image_meta pero la vista posts_public
-- (última definida en 058) no la expone → el frontend recibe
-- 42703 "column posts_public.image_meta does not exist" en todos los
-- SELECT que piden image_meta.
--
-- Recrea la vista idéntica a 058 + image_meta (patrón establecido:
-- DROP CASCADE + CREATE + security_invoker + GRANT).

DROP VIEW IF EXISTS public.posts_public CASCADE;

CREATE OR REPLACE VIEW public.posts_public AS
SELECT
  id,
  user_id,
  content,
  image_url,
  image_urls,
  image_meta,
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
  -- allowed_users — no expuesto (igual que 055/058)
  obfuscated_display,
  poll_data,
  scheduled_at,
  is_sensitive,
  community_id,
  created_at,
  updated_at
FROM posts;

ALTER VIEW public.posts_public SET (security_invoker = true);

GRANT SELECT ON public.posts_public TO anon, authenticated;
