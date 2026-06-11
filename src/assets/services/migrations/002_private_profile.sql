-- Migration 002: Add is_private column + follow request RLS policies
-- Run this in your Supabase SQL Editor

-- 1. Add is_private column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- 2. Allow profile owners to accept follow requests (INSERT)
--    The existing INSERT policy only allows auth.uid() = follower_id,
--    so the owner needs a separate policy to insert where they are following_id.
DROP POLICY IF EXISTS "Users can accept follow requests" ON follows;
CREATE POLICY "Users can accept follow requests"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = following_id);

-- 3. Allow profile owners to reject/cancel follow requests (DELETE)
--    The existing DELETE policy only allows auth.uid() = follower_id,
--    so the owner needs a separate policy to delete where they are following_id.
DROP POLICY IF EXISTS "Users can reject follow requests" ON follows;
CREATE POLICY "Users can reject follow requests"
  ON follows FOR DELETE
  USING (auth.uid() = following_id AND status = 'pending');

-- ⚠️ IMPORTANT: If you previously ran a version of this migration that changed
-- profile RLS policies, run the SQL below to restore the original policy:
--
--   DROP POLICY IF EXISTS "Profiles are viewable based on privacy" ON profiles;
--   CREATE POLICY "Public profiles are viewable by everyone"
--     ON profiles
--     FOR SELECT
--     USING (true);
