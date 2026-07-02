-- Add comments_allowed column to posts table
-- Values: 'everyone' (default), 'followers', 'nobody'

ALTER TABLE posts
ADD COLUMN comments_allowed text NOT NULL DEFAULT 'everyone'
CHECK (comments_allowed IN ('everyone', 'followers', 'nobody'));
