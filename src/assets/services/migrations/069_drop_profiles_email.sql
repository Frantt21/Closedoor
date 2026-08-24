-- ==============================================
-- Migration 069: Eliminar profiles.email (fuga de datos sensibles)
-- ==============================================
-- Historia del problema:
--   051: creó profiles_public (sin email) porque RLS no puede ocultar
--        COLUMNAS (solo filas). Las políticas de profiles quedaron
--        USING(true) para permitir perfiles públicos.
--   055: REVOKE SELECT ON profiles FROM anon (hardening correcto).
--   057: GRANT SELECT ON profiles TO anon, authenticated — las vistas
--        SECURITY INVOKER necesitan permiso sobre la tabla subyacente,
--        pero el frontend NUNCA migró a las vistas y siguió leyendo la
--        tabla directa → cualquier cliente anónimo podía leer emails.
--
-- Por qué eliminar la columna es seguro:
--   - El email real ya vive en auth.users (privado, gestionado por GoTrue).
--   - Cero lecturas de profiles.email en todo el repo (src/, api/,
--     server.js): verificado con grep. Solo los scripts de seguridad lo
--     consultan, y al no existir la columna reportan PROTEGIDO.
--
-- Rollback (si algún día hiciera falta):
--   ALTER TABLE public.profiles ADD COLUMN email TEXT;
--   -- backfill desde auth.users si se requiere:
--   UPDATE public.profiles p SET email = u.email
--     FROM auth.users u WHERE u.id = p.id;
-- ==============================================

-- 1. Eliminar la columna expuesta
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- 2. Limpiar la política que ya no tiene propósito (daba acceso al email propio)
DROP POLICY IF EXISTS "Users can view their own email" ON public.profiles;
