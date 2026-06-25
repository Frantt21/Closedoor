-- Migration 019: Add profile background image settings
-- Permite usar una imagen como fondo de página en el perfil,
-- con controles de posición, blur y opacidad.
-- Run this in your Supabase SQL Editor

-- Add profile_background_url column: URL of the background image
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_background_url TEXT DEFAULT NULL;

-- Add profile_background_position column: object-position value (e.g. "50% 50%")
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_background_position TEXT DEFAULT '50% 50%';

-- Add profile_background_blur column: blur amount in pixels (0 = no blur)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_background_blur INTEGER DEFAULT 0;

-- Add profile_background_dim column: dim opacity percentage (0-100, 50 = 50% dim)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_background_dim INTEGER DEFAULT 50;

COMMENT ON COLUMN profiles.profile_background_url IS 'URL of the profile page background image';
COMMENT ON COLUMN profiles.profile_background_position IS 'CSS object-position for the background image';
COMMENT ON COLUMN profiles.profile_background_blur IS 'Blur amount in pixels for the background image';
COMMENT ON COLUMN profiles.profile_background_dim IS 'Dim opacity (0-100) for better contrast over the background image';
