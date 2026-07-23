-- ==============================================
-- Migration 034: Allow chat participants to update messages
-- ==============================================
-- Esto permite guardar reacciones, fijados y otros cambios
-- en mensajes desde cualquier participante del chat.
-- ==============================================

DROP POLICY IF EXISTS "Update conversation messages" ON messages;
CREATE POLICY "Update conversation messages"
  ON messages FOR UPDATE
  USING (public.is_conversation_participant(conversation_id))
  WITH CHECK (public.is_conversation_participant(conversation_id));
