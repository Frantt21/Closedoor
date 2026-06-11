-- ==============================================
-- Migration 003: RLS DELETE policy for notifications
-- ==============================================

-- Permitir que usuarios eliminen sus propias notificaciones
CREATE POLICY "Users can delete their own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);
