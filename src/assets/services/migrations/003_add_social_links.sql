-- Agrega columna social_links (JSONB) a la tabla profiles
-- Almacena array de { platform: string, username: string, url: string }

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '[]'::jsonb;
