-- ════════════════════════════════════════════════════════
-- Migration 065: Chat bubble colors (per-conversation, per-user)
-- ════════════════════════════════════════════════════════
-- Permite personalizar el color de las burbujas del chat
-- (propias y del otro usuario) por conversación.
-- La preferencia es por usuario (como chat_nicknames): cada
-- participante ve sus propios colores y no afecta al otro.
-- ========================================================

CREATE TABLE IF NOT EXISTS chat_bubble_settings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  own_color VARCHAR(7),    -- hex #RRGGBB para burbujas propias (NULL = default)
  other_color VARCHAR(7),  -- hex #RRGGBB para burbujas del otro (NULL = default)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_bubble_settings_user ON chat_bubble_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_bubble_settings_conv ON chat_bubble_settings(conversation_id);

-- RLS: cada usuario solo ve/edita sus propias preferencias
ALTER TABLE chat_bubble_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View own bubble settings" ON chat_bubble_settings;
CREATE POLICY "View own bubble settings"
  ON chat_bubble_settings FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Insert own bubble settings" ON chat_bubble_settings;
CREATE POLICY "Insert own bubble settings"
  ON chat_bubble_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Update own bubble settings" ON chat_bubble_settings;
CREATE POLICY "Update own bubble settings"
  ON chat_bubble_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Delete own bubble settings" ON chat_bubble_settings;
CREATE POLICY "Delete own bubble settings"
  ON chat_bubble_settings FOR DELETE
  USING (user_id = auth.uid());

-- Realtime (sincroniza entre pestañas/dispositivos)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_bubble_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
