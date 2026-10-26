-- ════════════════════════════════════════════════════════
-- Migration 078: Fondo del chat (por-conversación, por-usuario)
-- ════════════════════════════════════════════════════════
-- Permite poner una imagen de fondo en una conversación concreta.
--
-- La preferencia es POR USUARIO (mismo patrón que chat_bubble_settings y
-- chat_nicknames): cada participante ve su propio fondo y el otro nunca lo ve
-- ni lo recibe. Por eso la imagen vive en esta tabla y no en `conversations`
-- (que es compartida) ni en `messages` (que es cifrado y de ambos).
--
-- RLS: cada usuario solo puede ver/escribir SUS filas (user_id = auth.uid()),
-- así que aunque el SELECT fuera sin filtro el otro participante nunca recibe
-- la fila. El filtro por conversation_id se añade en el cliente
-- (getChatBackgrounds) para traerlas todas de una vez.
-- ========================================================

CREATE TABLE IF NOT EXISTS chat_background_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- URL de la imagen (CDN propio o cualquier http(s)). NULL = sin fondo.
  image_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_background_settings_user ON chat_background_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_background_settings_conv ON chat_background_settings(conversation_id);

-- Grants explícitos (patrón del repo: RLS filtra filas, el GRANT da acceso a
-- la tabla). anon no toca nada: el fondo es siempre de un usuario autenticado.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_background_settings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.chat_background_settings_id_seq TO authenticated;

-- RLS: solo las filas propias
ALTER TABLE chat_background_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View own chat background" ON chat_background_settings;
CREATE POLICY "View own chat background"
  ON chat_background_settings FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Insert own chat background" ON chat_background_settings;
CREATE POLICY "Insert own chat background"
  ON chat_background_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Update own chat background" ON chat_background_settings;
CREATE POLICY "Update own chat background"
  ON chat_background_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delete own chat background" ON chat_background_settings;
CREATE POLICY "Delete own chat background"
  ON chat_background_settings FOR DELETE
  USING (user_id = auth.uid());

-- Realtime (sincroniza el fondo entre pestañas/dispositivos del mismo usuario)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_background_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
