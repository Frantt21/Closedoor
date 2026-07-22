-- ==============================================
-- Migration 033: Chat Message Features
-- ==============================================
-- Agrega columnas para pin, reacciones y borrado
-- de mensajes, más políticas RLS necesarias
-- ==============================================

-- ── Nuevas columnas en messages ──
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for TEXT[] NOT NULL DEFAULT '{}';

-- ── RLS: eliminar mensajes propios ──
DROP POLICY IF EXISTS "Delete own messages" ON messages;
CREATE POLICY "Delete own messages"
  ON messages FOR DELETE
  USING (sender_id = auth.uid());

-- ── RLS: actualizar mensajes propios ──
DROP POLICY IF EXISTS "Update own messages" ON messages;
CREATE POLICY "Update own messages"
  ON messages FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());
