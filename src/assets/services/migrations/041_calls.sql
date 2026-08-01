-- ==============================================
-- Migration 041: Voice Calls (LiveKit)
-- ==============================================
-- Tabla `calls` para llamadas de voz 1:1 (escalable a grupos).
-- El media/signaling lo maneja LiveKit Cloud (SFU). Esta tabla solo
-- guarda el estado de la llamada para el "ring", el historial y la
-- coordinación caller/callee (ringing → active → ended/missed/declined).
-- ==============================================

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  callee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room_name TEXT NOT NULL,                 -- nombre de sala LiveKit (call-{id})
  status TEXT NOT NULL DEFAULT 'ringing',  -- ringing | active | ended | missed | declined
  started_at TIMESTAMPTZ,                  -- cuando se acepta la llamada
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_calls_conversation ON calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at DESC);

-- ── RLS ──
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Ver: solo participantes de la conversación pueden ver sus llamadas
DROP POLICY IF EXISTS "View conversation calls" ON calls;
CREATE POLICY "View conversation calls"
  ON calls FOR SELECT
  USING (public.is_conversation_participant(conversation_id));

-- Insertar: el caller crea la llamada
DROP POLICY IF EXISTS "Insert calls" ON calls;
CREATE POLICY "Insert calls"
  ON calls FOR INSERT
  WITH CHECK (caller_id = auth.uid() AND public.is_conversation_participant(conversation_id));

-- Actualizar: participantes pueden actualizar el estado (aceptar, colgar, etc.)
DROP POLICY IF EXISTS "Update calls" ON calls;
CREATE POLICY "Update calls"
  ON calls FOR UPDATE
  USING (public.is_conversation_participant(conversation_id))
  WITH CHECK (public.is_conversation_participant(conversation_id));

-- ── Realtime (para el ring en vivo) ──
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE calls;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- REPLICA IDENTITY FULL: payload.old/new con todas las columnas en eventos Realtime
-- (mismo fix que 039 para messages)
ALTER TABLE calls REPLICA IDENTITY FULL;
