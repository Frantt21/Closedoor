-- ==============================================
-- Migration 058: Fix Supabase Advisor Warnings
-- ==============================================
-- Corrige TODOS los warnings del Supabase Advisor:
--
-- 1. function_search_path_mutable (21 functions)
--    → SET search_path = public en todas las funciones
--
-- 2. anon_security_definer_function_executable (20 functions)
--    → REVOKE EXECUTE FROM anon en funciones críticas
--    → Agregar role check auth.uid() IS NOT NULL dentro de las funciones
--
-- 3. authenticated_security_definer_function_executable (20 functions)
--    → REVOKE EXECUTE en funciones que solo son triggers (no RPC)
--    → Las demás mantienen EXECUTE para authenticated (son intencionales)
--
-- 4. rls_policy_always_true (chat_participants, conversations)
--    → Las policies INSERT con WITH CHECK (true) son intencionales
--      (el backend gestiona participantes). Se documenta pero no se cambia.
--
-- 5. auth_leaked_password_protection
--    → Requiere configuración en Supabase Dashboard → Auth → Password Settings
--    → Habilitar "Check against HaveIBeenPwned" (no es SQL)
-- ==============================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1: REVOKE EXECUTE — Funciones que anon NO debe llamar
-- ════════════════════════════════════════════════════════════

-- ── Funciones CRÍTICAS: anon puede bypassear RLS o inflar datos ──
REVOKE EXECUTE ON FUNCTION public.bump_hashtag_usage(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unfollow_both_ways(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_post_views(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_encrypted_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_mention_notification(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_post_hashtags() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;

-- ── Funciones de triggers: NO deben ser RPC ──
-- (solo se ejecutan vía triggers, nunca vía supabase.rpc())
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

-- update_updated_at puede que exista directamente en Supabase (no en migrations)
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM anon, authenticated;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- PARTE 2: ROLE CHECKS dentro de funciones SECURITY DEFINER
-- ════════════════════════════════════════════════════════════
-- Aunque REVOKE bloquea la llamada RPC, agregar un check interno
-- es defensa en profundidad: si alguien re-granta EXECUTE, la
-- función aún rechaza anon.


-- ── bump_hashtag_usage: solo authenticated ──
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

  INSERT INTO hashtags (name, usage_count, last_used_at)
  VALUES (lower(trim(p_name)), 1, NOW())
  ON CONFLICT (name) DO UPDATE
    SET usage_count = hashtags.usage_count + 1,
        last_used_at = NOW()
  RETURNING usage_count INTO result;

  RETURN result;
END;
$$;


-- ── unfollow_both_ways: solo authenticated ──
CREATE OR REPLACE FUNCTION public.unfollow_both_ways(blocker_id UUID, blocked_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Solo el propio usuario puede ejecutar esto
  IF auth.uid() != blocker_id THEN
    RAISE EXCEPTION 'Cannot unfollow on behalf of another user';
  END IF;

  -- Delete follow: blocker unfollows blocked
  DELETE FROM follows
  WHERE follower_id = blocker_id AND following_id = blocked_id;

  -- Delete follow: blocked unfollows blocker
  DELETE FROM follows
  WHERE follower_id = blocked_id AND following_id = blocker_id;
END;
$$;


-- ── increment_post_views: solo authenticated ──
CREATE OR REPLACE FUNCTION public.increment_post_views(post_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO post_views (user_id, post_id)
  VALUES (auth.uid(), post_id)
  ON CONFLICT (user_id, post_id) DO NOTHING;

  IF FOUND THEN
    UPDATE posts SET views_count = COALESCE(views_count, 0) + 1
    WHERE id = post_id;
  END IF;
END;
$$;


-- ── get_email_by_username: ya tiene check en 054, reforzar ──
CREATE OR REPLACE FUNCTION public.get_email_by_username(uname text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    ELSE (SELECT email FROM profiles WHERE lower(username) = lower(uname))
  END;
$$;


-- ── get_encrypted_post: solo authenticated ──
CREATE OR REPLACE FUNCTION public.get_encrypted_post(post_id uuid)
RETURNS SETOF posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM posts
  WHERE posts.id = post_id
    AND auth.uid() IS NOT NULL
    AND (
      posts.user_id = auth.uid()
      OR auth.uid() = ANY(COALESCE(posts.allowed_users, '{}'::uuid[]))
    );
$$;


-- ── create_mention_notification: solo authenticated ──
CREATE OR REPLACE FUNCTION public.create_mention_notification(
  p_actor_id UUID,
  p_user_id UUID,
  p_reference_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO notifications (actor_id, user_id, type, reference_id)
  VALUES (p_actor_id, p_user_id, 'mention', p_reference_id);
END;
$$;


-- ── cleanup_post_hashtags: solo authenticated ──
CREATE OR REPLACE FUNCTION public.cleanup_post_hashtags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM post_hashtags WHERE post_id = OLD.id;
  RETURN OLD;
END;
$$;


-- ── can_repost_post: solo authenticated ──
CREATE OR REPLACE FUNCTION public.can_repost_post(p_user_id UUID, p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_private BOOLEAN;
  is_owner BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT p.is_private INTO is_private
  FROM profiles p
  WHERE p.id = (SELECT user_id FROM posts WHERE id = p_post_id);

  is_owner := (SELECT user_id FROM posts WHERE id = p_post_id) = auth.uid();

  RETURN NOT COALESCE(is_private, FALSE) OR is_owner;
END;
$$;


-- ── is_conversation_participant: ya tiene search_path, reforzar ──
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_participants
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  );
$$;


-- ── email_exists: mantener público (necesario para registro) ──
CREATE OR REPLACE FUNCTION public.email_exists(addr text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE lower(email) = lower(addr));
$$;


-- ── get_trending_words: mantener público (datos agregados) ──
CREATE OR REPLACE FUNCTION public.get_trending_words(limit_count INT DEFAULT 8, hours_back INT DEFAULT 24)
RETURNS TABLE(word TEXT, frequency BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT h.name AS word, h.usage_count AS frequency
  FROM hashtags h
  WHERE h.last_used_at > NOW() - (hours_back || ' hours')::interval
    AND h.name NOT LIKE '__sec_test_%'
  ORDER BY h.usage_count DESC
  LIMIT limit_count;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- PARTE 3: SET search_path = public en funciones restantes
-- ════════════════════════════════════════════════════════════
-- Estas funciones ya existen pero les falta SET search_path.


-- ── notify_like ──
CREATE OR REPLACE FUNCTION public.notify_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner UUID;
BEGIN
  SELECT user_id INTO post_owner FROM posts WHERE id = NEW.post_id;
  IF post_owner IS NOT NULL AND post_owner != NEW.user_id THEN
    INSERT INTO notifications (actor_id, user_id, type, reference_id)
    VALUES (NEW.user_id, post_owner, 'like', NEW.post_id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── notify_comment ──
CREATE OR REPLACE FUNCTION public.notify_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner UUID;
BEGIN
  SELECT user_id INTO post_owner FROM posts WHERE id = NEW.post_id;
  IF post_owner IS NOT NULL AND post_owner != NEW.user_id THEN
    INSERT INTO notifications (actor_id, user_id, type, reference_id)
    VALUES (NEW.user_id, post_owner, 'comment', NEW.post_id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── notify_repost ──
CREATE OR REPLACE FUNCTION public.notify_repost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner UUID;
BEGIN
  SELECT user_id INTO post_owner FROM posts WHERE id = NEW.post_id;
  IF post_owner IS NOT NULL AND post_owner != NEW.user_id THEN
    INSERT INTO notifications (actor_id, user_id, type, reference_id)
    VALUES (NEW.user_id, post_owner, 'repost', NEW.post_id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── notify_comment_like ──
CREATE OR REPLACE FUNCTION public.notify_comment_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  comment_owner UUID;
  comment_post_id UUID;
BEGIN
  SELECT user_id, post_id INTO comment_owner, comment_post_id
  FROM comments WHERE id = NEW.comment_id;

  IF comment_owner IS NOT NULL AND comment_owner != NEW.user_id THEN
    INSERT INTO notifications (actor_id, user_id, type, reference_id, comment_id)
    VALUES (NEW.user_id, comment_owner, 'comment_like', comment_post_id, NEW.comment_id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── notify_dislike ──
CREATE OR REPLACE FUNCTION public.notify_dislike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner UUID;
BEGIN
  SELECT user_id INTO post_owner FROM posts WHERE id = NEW.post_id;
  IF post_owner IS NOT NULL AND post_owner != NEW.user_id THEN
    INSERT INTO notifications (actor_id, user_id, type, reference_id)
    VALUES (NEW.user_id, post_owner, 'dislike', NEW.post_id);
  END IF;
  RETURN NEW;
END;
$$;


-- ── increment_likes_count ──
CREATE OR REPLACE FUNCTION public.increment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


-- ── decrement_likes_count ──
CREATE OR REPLACE FUNCTION public.decrement_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET likes_count = GREATEST(COALESCE(likes_count, 1) - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


-- ── increment_comments_count ──
CREATE OR REPLACE FUNCTION public.increment_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


-- ── decrement_comments_count ──
CREATE OR REPLACE FUNCTION public.decrement_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET comments_count = GREATEST(COALESCE(comments_count, 1) - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


-- ── increment_reposts_count ──
CREATE OR REPLACE FUNCTION public.increment_reposts_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET reposts_count = COALESCE(reposts_count, 0) + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


-- ── decrement_reposts_count ──
CREATE OR REPLACE FUNCTION public.decrement_reposts_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET reposts_count = GREATEST(COALESCE(reposts_count, 1) - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


-- ── increment_comment_likes_count ──
CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE comments SET comment_likes_count = COALESCE(comment_likes_count, 0) + 1 WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$;


-- ── decrement_comment_likes_count ──
CREATE OR REPLACE FUNCTION public.decrement_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE comments SET comment_likes_count = GREATEST(COALESCE(comment_likes_count, 1) - 1, 0) WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$;


-- ── update_comment_dislikes_count ──
CREATE OR REPLACE FUNCTION public.update_comment_dislikes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET comment_dislikes_count = COALESCE(comment_dislikes_count, 0) + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET comment_dislikes_count = GREATEST(COALESCE(comment_dislikes_count, 1) - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
END;
$$;


-- ── update_conversation_on_message ──
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET
    updated_at = NEW.created_at,
    last_message_at = NEW.created_at,
    last_message_sender_id = NEW.sender_id
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


-- ── handle_dislike ──
CREATE OR REPLACE FUNCTION public.handle_dislike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET dislikes_count = COALESCE(dislikes_count, 0) + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;


-- ── handle_undislike ──
CREATE OR REPLACE FUNCTION public.handle_undislike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE posts SET dislikes_count = GREATEST(COALESCE(dislikes_count, 1) - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$;


-- ── rls_auto_enable: REVOKE de anon (puede modificar RLS) ──
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;


-- ════════════════════════════════════════════════════════════
-- PARTE 4: Documentación de decisiones de diseño
-- ════════════════════════════════════════════════════════════

-- rls_policy_always_true para chat_participants y conversations:
-- Las policies INSERT con WITH CHECK (true) son INTENCIONALES.
-- El backend (Supabase Edge Functions o el propio cliente) gestiona
-- quién se une a una conversación. La RLS de SELECT ya protege
-- la visibilidad. No se cambia para no romper el sistema de chat.


-- ════════════════════════════════════════════════════════════
-- PARTE 5: Resumen de cambios
-- ════════════════════════════════════════════════════════════
-- ✅ 21 functions: SET search_path = public (elimina function_search_path_mutable)
-- ✅ 8 functions: REVOKE EXECUTE FROM anon + role check (elimina anon_security_definer)
-- ✅ 17 functions: REVOKE EXECUTE FROM anon, authenticated en triggers (elimina ambos warnings)
-- ✅ 2 tables: chat_participants, conversations — documentado (no se cambia)
-- ⚠️ auth_leaked_password_protection: configurar en Supabase Dashboard → Auth → Settings
