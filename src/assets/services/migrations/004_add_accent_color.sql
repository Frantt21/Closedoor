-- Add accent_color column to profiles table
-- Stores the user's chosen accent color as a hex string (e.g., '#ff6b6b')
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) DEFAULT NULL;
