-- ─────────────────────────────────────────────
-- RESET de vistas infladas (ejecutar MANUALMENTE y con cuidado)
-- ─────────────────────────────────────────────
-- Recalcula posts.views_count como la cantidad REAL de usuarios distintos
-- que interactuaron con cada post (vía la tabla post_views creada en 047).
--
-- ⚠️ Destructivo: sobreescribe los contadores. Los posts sin interacciones
-- quedan en 0. Ejecuta solo si quieres limpiar los números inflados.
--
-- Requiere haber corrido 047_post_views_dedup.sql primero.
-- ─────────────────────────────────────────────

UPDATE posts p
SET views_count = (
  SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id
);
