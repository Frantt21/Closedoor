-- ==============================================
-- Migration 032: Chat System
-- ==============================================
-- Tablas para el sistema de chat privado
-- - conversations: hilos de conversación
-- - chat_participants: participantes de cada conversación
-- - messages: mensajes encriptados con AES-256-GCM
-- ==============================================

-- ── 1. Conversations ──
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_text TEXT,         -- preview del último mensaje (texto ofuscado)
  last_message_at TIMESTAMPTZ,    -- timestamp del último mensaje
  last_message_sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- ── 2. Chat participants ──
CREATE TABLE IF NOT EXISTS chat_participants (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,       -- para saber si hay mensajes no leídos
  UNIQUE(conversation_id, user_id)
);

-- ── 3. Messages (encriptados) ──
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,        -- contenido cifrado en base64
  iv TEXT NOT NULL,                -- vector de inicialización en base64
  encrypted_for TEXT[] NOT NULL,   -- IDs de usuarios para quienes está cifrado
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_chat_participants_conv ON chat_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- ── RLS ──
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════
-- Función helper SECURITY DEFINER para evitar recursión RLS
-- Todas las políticas que necesitan verificar participación
-- en chat_participants usan esta función, que corre con
-- privilegios del owner (postgres) y bypassa RLS.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_participants
    WHERE conversation_id = conv_id AND user_id = auth.uid()
  );
$$;

-- Conversations: solo visible para participantes
DROP POLICY IF EXISTS "View own conversations" ON conversations;
CREATE POLICY "View own conversations"
  ON conversations FOR SELECT
  USING (public.is_conversation_participant(id));

DROP POLICY IF EXISTS "Insert conversations" ON conversations;
CREATE POLICY "Insert conversations"
  ON conversations FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Update own conversations" ON conversations;
CREATE POLICY "Update own conversations"
  ON conversations FOR UPDATE
  USING (public.is_conversation_participant(id));

-- Participants: visible para todos los miembros de la conversación
DROP POLICY IF EXISTS "View own participations" ON chat_participants;
DROP POLICY IF EXISTS "View conversation participants" ON chat_participants;
CREATE POLICY "View conversation participants"
  ON chat_participants FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "Insert participants" ON chat_participants;
CREATE POLICY "Insert participants"
  ON chat_participants FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Update own participations" ON chat_participants;
CREATE POLICY "Update own participations"
  ON chat_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Messages: solo participantes pueden ver
DROP POLICY IF EXISTS "View conversation messages" ON messages;
CREATE POLICY "View conversation messages"
  ON messages FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "Insert own messages" ON messages;
CREATE POLICY "Insert own messages"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

-- Delete: solo participantes pueden borrar (toggle para borrar del lado del usuario)
DROP POLICY IF EXISTS "Delete own conversations" ON conversations;
CREATE POLICY "Delete own conversations"
  ON conversations FOR DELETE
  USING (public.is_conversation_participant(id));

-- ── Realtime (con manejo de errores para re-ejecución) ──
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE chat_participants;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- ── Trigger: actualizar updated_at y last_message en conversations ──
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE conversations
  SET
    updated_at = NEW.created_at,
    last_message_at = NEW.created_at,
    last_message_sender_id = NEW.sender_id
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_on_message ON messages;
CREATE TRIGGER trg_conversation_on_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_message();
