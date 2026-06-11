-- ==============================================
-- Migration 008: Columna mentions en posts para menciones persistentes
-- ==============================================
-- Almacena un mapping JSONB de {user_id: "username_al_momento"}
-- para que las menciones sobrevivan cambios de username.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS mentions JSONB DEFAULT '{}'::jsonb;
