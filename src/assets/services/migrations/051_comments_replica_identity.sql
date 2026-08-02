-- ─────────────────────────────────────────────────────────────────────────────
-- 051_comments_replica_identity.sql
-- Habilita REPLICA IDENTITY FULL en la tabla comments.
--
-- Contexto: los eventos INSERT/UPDATE de Realtime llegan bien porque usan
-- payload.new (la fila nueva siempre incluye todas las columnas). Pero los
-- eventos DELETE usan payload.old, que con REPLICA IDENTITY DEFAULT (solo la
-- primary key) NO incluye post_id → el filtro post_id=eq.X nunca coincide en
-- un DELETE y los demás clientes no ven el comentario eliminado en vivo.
--
-- Con REPLICA IDENTITY FULL, payload.old contendrá TODAS las columnas y el
-- filtro post_id=eq.X de la suscripción funcionará también para deletes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.comments REPLICA IDENTITY FULL;
