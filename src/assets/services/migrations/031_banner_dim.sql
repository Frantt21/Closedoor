-- Migration 031: Add banner_dim for configurable banner dark overlay
-- Controls the darkness of the gradient overlay on the profile banner
-- Range: 0 (no dim) to 100 (full dark), default 50

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banner_dim INTEGER DEFAULT 50;

-- Set default for existing rows that are NULL
UPDATE profiles SET banner_dim = 50 WHERE banner_dim IS NULL;

ALTER TABLE profiles ALTER COLUMN banner_dim SET DEFAULT 50;
ALTER TABLE profiles ALTER COLUMN banner_dim SET NOT NULL;

COMMENT ON COLUMN profiles.banner_dim IS 'Banner overlay darkness (0-100). Higher = darker overlay for text contrast.';
