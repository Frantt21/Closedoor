-- ==============================================
-- Migration 071: Restaurar GRANT UPDATE en profiles (fix toggle show_global_bg)
-- ==============================================
-- Síntoma: PATCH /rest/v1/profiles → 403 / 42501 "permission denied for
-- table profiles" al guardar show_global_bg.
--
-- Causa raíz (historial):
--   053: REVOKE ALL + re-grants con LISTAS DE COLUMNAS fijas:
--        GRANT UPDATE (id, username, ..., song) — enumeración cerrada.
--   057: GRANT SELECT a nivel TABLA (por eso leer siempre funcionó,
--        incluida cualquier columna nueva).
--   El UPDATE nunca volvió a nivel tabla → toda columna añadida después
--   de 053 (p.ej. show_global_bg en 070) NO es escribible por authenticated.
--
-- Fix: reset limpio de privilegios y re-grants a nivel tabla.
-- RLS sigue siendo el controlador real de qué FILAS toca cada rol.

-- 1. Limpiar TODOS los grants previos (tabla y por-columna)
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM authenticated;

-- 2. Lectura para ambos (las vistas SECURITY INVOKER de 051/057 necesitan
--    SELECT sobre la tabla subyacente con el rol que consulta)
GRANT SELECT ON public.profiles TO anon, authenticated;

-- 3. Escritura solo autenticada, todas las columnas (actuales y futuras).
--    Las políticas RLS limitan cada operación a auth.uid() = id.
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

-- 4. anon jamás escribe perfiles (053 le había dado INSERT/UPDATE/DELETE
--    por columna — RLS lo bloqueaba en la práctica, pero no debía existir)
