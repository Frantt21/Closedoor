-- Migration 021: Unfollow both ways RPC function
-- Elimina los follows en ambos sentidos al bloquear a un usuario.
-- Usa SECURITY DEFINER para bypass RLS (el usuario no puede eliminar follows de otros).
-- Run this in your Supabase SQL Editor

CREATE OR REPLACE FUNCTION unfollow_both_ways(blocker_id UUID, blocked_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete follow: blocker unfollows blocked
  DELETE FROM follows
  WHERE follower_id = blocker_id AND following_id = blocked_id;

  -- Delete follow: blocked unfollows blocker
  DELETE FROM follows
  WHERE follower_id = blocked_id AND following_id = blocker_id;
END;
$$;

COMMENT ON FUNCTION unfollow_both_ways IS 'Deletes follows in both directions between two users. Used when blocking to ensure both users stop following each other.';
