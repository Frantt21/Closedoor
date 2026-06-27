-- ==============================================
-- Migration 027: Polls & Scheduled Posts
-- ==============================================
-- 1. Añade poll_data (JSONB) y scheduled_at (TIMESTAMPTZ) a posts
-- 2. Crea tabla poll_votes para almacenar votos
-- 3. Crea índices necesarios
-- ==============================================

-- ── Poll data column ──
-- poll_data = {
--   "question": "What's your favorite color?",
--   "options": [
--     {"id": "opt_1", "text": "Red"},
--     {"id": "opt_2", "text": "Blue"},
--     {"id": "opt_3", "text": "Green"}
--   ],
--   "expires_at": "2024-12-31T23:59:59Z"
-- }
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS poll_data JSONB,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- ── Poll votes table ──
CREATE TABLE IF NOT EXISTS poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, user_id)  -- Un voto por usuario por post
);

-- ── Indices ──
CREATE INDEX IF NOT EXISTS idx_poll_votes_post_id ON poll_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_user_id ON poll_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- ── RLS for poll_votes ──
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede votar
CREATE POLICY poll_votes_insert ON poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Cada usuario puede ver los votos (para contar)
CREATE POLICY poll_votes_select ON poll_votes
  FOR SELECT TO authenticated
  USING (true);

-- Cada usuario puede eliminar su propio voto
CREATE POLICY poll_votes_delete ON poll_votes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── Habilitar Realtime para poll_votes ──
-- Nota: si la tabla ya está en la publicación, ignora el error de duplicado
ALTER PUBLICATION supabase_realtime ADD TABLE poll_votes;
