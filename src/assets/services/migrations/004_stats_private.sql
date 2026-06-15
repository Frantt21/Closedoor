-- Migration 004: Add stats_private column for granular stats privacy
-- Run this in your Supabase SQL Editor

-- Add stats_private column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stats_private BOOLEAN DEFAULT false;
