-- ==============================================
-- Migration 060: Communities +18 (mature content)
-- ==============================================
-- Marca la comunidad como contenido para adultos (+18).
-- Solo informativo por ahora (badge en cards y header); el servicio y la
-- UI pueden usar is_mature para ocultar/blur contenido si se decide más
-- adelante (mismo patrón que posts.is_sensitive).
-- ==============================================

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS is_mature BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN communities.is_mature IS 'When true, the community is marked as +18 (mature content)';
