/**
 * Performance indexes for faster queries.
 *
 * Run this in the Supabase SQL Editor or via migration.
 * These indexes target the queries that PageSpeed identified as slow:
 * - Posts feed (875-1085ms): filtering by user_id + ordering by created_at
 * - Profiles query: filtering public profiles
 * - Follows queries: finding who you follow / who follows you
 * - Notifications: filtering by user_id
 */

-- ── POSTS: Feed queries ──
-- The main feed filters by user_id IN (...) and orders by created_at DESC
-- A composite index covers both the WHERE and ORDER BY in one scan
CREATE INDEX IF NOT EXISTS idx_posts_user_id_created_at
  ON public.posts (user_id, created_at DESC);

-- General feed (without user_id filter) orders by created_at DESC
CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON public.posts (created_at DESC);

-- Filter out encrypted and scheduled posts efficiently
CREATE INDEX IF NOT EXISTS idx_posts_feed_filter
  ON public.posts (is_encrypted, scheduled_at)
  WHERE is_encrypted = false AND scheduled_at IS NULL;

-- Profile content: user's posts ordered by pinned then created_at
CREATE INDEX IF NOT EXISTS idx_posts_user_id_pinned_created
  ON public.posts (user_id, is_pinned DESC, created_at DESC);

-- ── PROFILES: Public profile queries ──
CREATE INDEX IF NOT EXISTS idx_profiles_is_private
  ON public.profiles (is_private)
  WHERE is_private = false OR is_private IS NULL;

-- Username lookups (login, profile page)
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (lower(username));

-- ── FOLLOWS: Following/follower queries ──
-- Who do I follow? (follower_id + status)
CREATE INDEX IF NOT EXISTS idx_follows_follower_status
  ON public.follows (follower_id, status);

-- Who follows me? (following_id + status)
CREATE INDEX IF NOT EXISTS idx_follows_following_status
  ON public.follows (following_id, status);

-- ── NOTIFICATIONS: Notification list ──
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created
  ON public.notifications (user_id, created_at DESC);

-- ── LIKES: Check if user liked a post ──
CREATE INDEX IF NOT EXISTS idx_likes_user_post
  ON public.likes (user_id, post_id);

-- ── BLOCKS: Block checks ──
CREATE INDEX IF NOT EXISTS idx_blocks_blocker_blocked
  ON public.blocks (blocker_id, blocked_id);

CREATE INDEX IF NOT EXISTS idx_blocks_blocked_blocker
  ON public.blocks (blocked_id, blocker_id);
