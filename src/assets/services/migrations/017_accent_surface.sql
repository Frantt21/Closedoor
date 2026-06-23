-- Migration 017: Surface color and glass mode for postcards & sidebar containers
-- Run this in your Supabase SQL Editor
--
-- accent_surface_color: custom color for postcards and sidebar container backgrounds
-- accent_surface_glass: boolean flag to toggle glass/blur mode (ON = translucent+blur, OFF = solid color)

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS accent_surface_color TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS accent_surface_glass BOOLEAN DEFAULT false;

COMMENT ON COLUMN profiles.accent_surface_color IS 'Custom background color for postcards and profile sidebar containers on the profile page.';
COMMENT ON COLUMN profiles.accent_surface_glass IS 'When true, applies a translucent glassmorphism effect (blur + subtle border) instead of using the solid surface color.';
