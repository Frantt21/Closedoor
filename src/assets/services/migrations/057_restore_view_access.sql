-- ==============================================
-- Migration 057: Restore view access for anon
-- ==============================================
-- La migración 055 revocó SELECT en las tablas raw
-- (posts, profiles), pero las vistas SECURITY INVOKER
-- necesitan que anon tenga SELECT en las tablas
-- subyacentes para funcionar.
--
-- Solución: restaurar SELECT en las tablas raw,
-- las vistas ya filtran columnas sensibles
-- (email en profiles_public, encrypted_content
-- en posts_public).
-- ==============================================


-- Restaurar SELECT en tablas raw para que las vistas funcionen
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;


-- Asegurar que las vistas tengan GRANT explícito
GRANT SELECT ON public.profiles_public TO anon, authenticated;
GRANT SELECT ON public.posts_public TO anon, authenticated;


-- Nota: las vistas SECURITY INVOKER aplican RLS de la tabla
-- subyacente. profiles_public no expone email (columna ausente
-- en el SELECT). posts_public no expone encrypted_content ni
-- allowed_users. La seguridad depende de que el frontend use
-- las vistas, no las tablas raw.
