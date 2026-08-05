-- ==============================================
-- Migration 059: Fix remaining Advisor warnings
-- ==============================================
-- La migración 058 definió las funciones correctamente pero
-- CREATE OR REPLACE re-granta EXECUTE automáticamente en Supabase.
-- Este script aplica REVOKE DESPUÉS de las definiciones para
-- que el warning desaparezca.
-- ==============================================


-- ════════════════════════════════════════════════════════════
-- 1. FIX: update_updated_at (falta SET search_path)
-- ════════════════════════════════════════════════════════════
DO $$ BEGIN
  ALTER FUNCTION public.update_updated_at() SET search_path = public;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 2. REVOKE EXECUTE — funciones que solo son triggers
-- ════════════════════════════════════════════════════════════
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.notify_like() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_comment() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_repost() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_comment_like() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.notify_dislike() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.increment_likes_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.decrement_likes_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.increment_comments_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.decrement_comments_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.increment_reposts_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.decrement_reposts_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.increment_comment_likes_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.decrement_comment_likes_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_comment_dislikes_count() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_conversation_on_message() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.handle_dislike() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.handle_undislike() FROM anon, authenticated;
  REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- 3. REVOKE EXECUTE — funciones SECURITY DEFINER para anon
-- ════════════════════════════════════════════════════════════
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.bump_hashtag_usage(text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.unfollow_both_ways(uuid, uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.increment_post_views(uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.get_encrypted_post(uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.create_mention_notification(uuid, uuid, uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.cleanup_post_hashtags() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
  REVOKE EXECUTE ON FUNCTION public.can_repost_post(uuid, uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM anon;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
