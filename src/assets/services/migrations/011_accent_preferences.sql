-- Migration 011: Add accent visibility preferences
-- Run this in your Supabase SQL Editor

-- Add show_accent_profile column: whether the user enables accent colors on their profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_accent_profile BOOLEAN DEFAULT true;

-- Add show_accent_explore column: whether the user's accent color shows on their Explore card
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_accent_explore BOOLEAN DEFAULT true;

-- Add accent_visibility column: who can see the user's accent colors
-- 'both' = everyone, 'me' = only the profile owner, 'others' = only other users
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS accent_visibility TEXT DEFAULT 'both';
