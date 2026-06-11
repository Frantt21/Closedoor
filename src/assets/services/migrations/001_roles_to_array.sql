-- ==========================================
-- Migration 001: role (text) → roles (text[])
-- Permite múltiples roles por usuario
-- ==========================================

-- 1. Eliminar el default existente para evitar error de casting
ALTER TABLE profiles 
  ALTER COLUMN role DROP DEFAULT;

-- 2. Cambiar el tipo de text a text[] y renombrar
ALTER TABLE profiles 
  ALTER COLUMN role TYPE text[] 
  USING array[role];

ALTER TABLE profiles 
  RENAME COLUMN role TO roles;

-- 3. Asignar el nuevo default como array con 'user'
ALTER TABLE profiles 
  ALTER COLUMN roles SET DEFAULT '{user}';

-- ==========================================
-- Uso en queries:
--   SELECT * FROM profiles WHERE roles @> '{admin}';
--   UPDATE profiles SET roles = '{admin,dev}' WHERE id = '...';
-- ==========================================
