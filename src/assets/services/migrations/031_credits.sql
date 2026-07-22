-- ==============================================
-- Migration 031: Media credits
-- ==============================================
-- Adds fields to store attribution/credits for
-- banner and avatar images.
-- ==============================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS banner_credits TEXT,
  ADD COLUMN IF NOT EXISTS avatar_credits TEXT;
