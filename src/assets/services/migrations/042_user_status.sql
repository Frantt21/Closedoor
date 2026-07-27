-- ──────────────────────────────────────────────
-- Migration 042: Add user_status to profiles
-- ──────────────────────────────────────────────
-- Values: 'online' | 'idle' | 'dnd' | 'disconnected'
-- Default: 'online'

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_status text NOT NULL DEFAULT 'online';

-- Index for Realtime filters on status
CREATE INDEX IF NOT EXISTS idx_profiles_user_status
  ON public.profiles (user_status)
  WHERE user_status != 'disconnected';
