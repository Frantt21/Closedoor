-- Migration 015: Image position for banner and avatar (drag-to-position)
-- Run this in your Supabase SQL Editor

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS banner_position TEXT DEFAULT '50% 50%',
ADD COLUMN IF NOT EXISTS avatar_position TEXT DEFAULT '50% 50%';
