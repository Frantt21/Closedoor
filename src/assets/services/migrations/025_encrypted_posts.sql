-- ==============================================
-- Migration 025: Encrypted Posts (AlphabetEncryption)
-- ==============================================
-- Habilita que un post tenga contenido ofuscado visible solo
-- para usuarios seleccionados por el autor.
--
-- is_encrypted: flag que indica si el post está ofuscado
-- encrypted_content: contenido cifrado con AES-GCM (base64)
-- encrypted_iv: vector de inicialización para descifrado (base64)
-- allowed_users: array de UUIDs de usuarios que pueden descifrar
-- obfuscated_display: representación visual del texto ofuscado
--   (código palindrómico del AlphabetEncryption)
-- ==============================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS encrypted_content TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_iv TEXT,
  ADD COLUMN IF NOT EXISTS allowed_users UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS obfuscated_display TEXT;

-- Índice GIN para búsqueda rápida de posts que un usuario puede ver
CREATE INDEX IF NOT EXISTS idx_posts_allowed_users
  ON posts USING GIN (allowed_users);

-- Actualizar la tabla de posts para que el Realtime incluya
-- los nuevos campos (útil para notificaciones en vivo)
-- Nota: si la tabla ya tiene REPLICA IDENTITY FULL, no hace falta
