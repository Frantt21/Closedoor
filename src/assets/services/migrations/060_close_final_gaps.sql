-- ==============================================
-- Migration 060: Close final security gaps
-- ==============================================
-- Cierra las 2 fugas restantes para usuarios autenticados:
--
-- 1. get_email_by_username: authenticated podía enumerar emails
--    de cualquier usuario conociendo su username.
--    → REVOKE de authenticated. Login por username ya no funciona
--      (solo login con email).
--
-- 2. rls_auto_enable: authenticated podía habilitar RLS en tablas.
--    → REVOKE de authenticated. Solo el superuser puede hacerlo.
-- ==============================================


-- 1. Bloquear enumeración de emails por username
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM authenticated;


-- 2. Bloquear rls_auto_enable para usuarios normales
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;


-- ════════════════════════════════════════════════════════════
-- Impacto en el frontend:
-- ════════════════════════════════════════════════════════════
-- Login por username YA NO FUNCIONA (era un risk: scraping de emails).
-- El frontend solo acepta email + password.
-- Esto ya estaba contemplado en la migración 054 pero el REVOKE
-- de authenticated no se había aplicado.
