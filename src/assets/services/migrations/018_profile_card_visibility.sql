-- Migration 018: Add profile card visibility preferences
-- Controla qué cards se muestran en el perfil del usuario
-- Run this in your Supabase SQL Editor

-- Add show_interests column: whether the interests card is visible on the profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_interests BOOLEAN DEFAULT true;

-- Add show_profile_stats column: whether the stats card is visible on the profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_profile_stats BOOLEAN DEFAULT true;

-- Add show_trending column: whether the trending card is visible on the profile page
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_trending BOOLEAN DEFAULT true;

COMMENT ON COLUMN profiles.show_interests IS 'Controls visibility of the interests card on the user profile';
COMMENT ON COLUMN profiles.show_profile_stats IS 'Controls visibility of the stats card on the user profile';
COMMENT ON COLUMN profiles.show_trending IS 'Controls visibility of the trending card on the user profile page';
