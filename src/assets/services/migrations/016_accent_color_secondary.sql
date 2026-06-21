-- Add secondary accent color column to profiles
-- The user can pick a secondary accent color manually (via color picker in the edit modal)
-- while the primary accent_color is extracted from the banner.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS accent_color_secondary text DEFAULT NULL;

-- Add a comment to document the column
COMMENT ON COLUMN profiles.accent_color_secondary IS 'Secondary accent color chosen manually by the user. Used together with accent_color for gradient backgrounds on profile page and explore cards.';
