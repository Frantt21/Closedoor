-- Add displayname column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS displayname TEXT;

-- Index for displayname search (optional but helpful)
CREATE INDEX IF NOT EXISTS profiles_displayname_idx ON profiles (displayname);

-- Migrate existing data: copy username to displayname for profiles where displayname is NULL
UPDATE profiles SET displayname = username WHERE displayname IS NULL;
