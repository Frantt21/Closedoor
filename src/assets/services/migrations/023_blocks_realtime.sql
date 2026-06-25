-- Migration 023: Add blocks table to Realtime publication
-- Necesario para que las suscripciones Realtime funcionen en blocks.
-- Si ya ejecutaste esto desde el dashboard de Supabase, omite esta migración.
-- ==============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'blocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE blocks;
  END IF;
END
$$;
