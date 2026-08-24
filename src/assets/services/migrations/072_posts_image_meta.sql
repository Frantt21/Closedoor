-- ==============================================
-- Migration 072: posts.image_meta — dimensiones reales de imágenes
-- ==============================================
-- Objetivo: que las PostCards rendericen las imágenes con su RATIO REAL
-- (sin recortes object-fit: cover) reservando el espacio exacto ANTES de
-- cargar la imagen (cero layout shift / CLS).
--
-- Formato: JSONB array paralelo a image_urls, alineado por posición:
--   [ { "u": "<url>", "w": 1200, "h": 800 }, ... ]
--   u = url (normalizada relativa /cdn/files/<id>), w/h = píxeles del
--   archivo procesado por el CDN. El frontend construye un mapa url→dims.
--
-- Posts legacy sin meta: el frontend mide la imagen al cargar (onLoad) y
-- adopta su ratio natural; mientras tanto usa el placeholder actual.
--
-- RLS: hereda las políticas existentes de posts (column-level grants no
-- aplican; anon/authenticated ya tienen sus GRANT de tabla).

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS image_meta JSONB DEFAULT NULL;

COMMENT ON COLUMN public.posts.image_meta IS
  'Dimensiones reales [{u,w,h}] paralelas a image_urls para aspect-ratio sin CLS';
