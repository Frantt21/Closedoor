-- Migration 010: Add interests column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS interests TEXT[] DEFAULT '{}';
