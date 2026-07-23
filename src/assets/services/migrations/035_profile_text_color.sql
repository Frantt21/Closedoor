-- Add profile_text_color column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS profile_text_color text;
