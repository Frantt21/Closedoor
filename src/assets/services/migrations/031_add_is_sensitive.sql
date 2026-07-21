-- Add is_sensitive column to posts table
-- Allows users to mark their posts as containing sensitive or mature content

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN posts.is_sensitive IS 'When true, media in the post will be blurred with a warning overlay';
