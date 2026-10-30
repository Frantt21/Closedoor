-- ==============================================
-- Migration 081: Programa abierto compartido (segunda actividad del perfil)
-- ==============================================
-- Hasta ahora `profiles.activity` guardaba UNA actividad detectada (canción,
-- vídeo o juego). Ahora el perfil puede mostrar dos cosas a la vez:
--
--   1. Lo que suena / se juega  → `activity` (079, lo escribe el watcher)
--   2. Un programa abierto       → `program_activity` (esta migración)
--
-- La segunda es una ELECCIÓN del usuario: Ajustes → Actividad lista los
-- programas abiertos en su equipo (desktop/activity.js → listRunningApps) y
-- guarda el elegido aquí. Por eso no lleva `*_updated_at` ni caduca como la 079:
-- sigue vigente hasta que la cambie o la quite.
--
-- Shape (mismo normalizador, services/activityService.js):
--   { "kind": "app", "title": "Photoshop", "subtitle": null,
--     "album": null, "app": "Photoshop", "url": null }
--
-- Sin GRANTs: la 071 dejó los privilegios a nivel TABLA, así que la columna
-- nueva queda legible y escribible sin tocar permisos. Las políticas RLS de
-- profiles siguen limitando la escritura a auth.uid() = id.
--
-- La privacidad (activity_enabled / activity_visibility, migración 080) aplica
-- igual a las dos: con 'nobody' o desactivada, el cliente limpia ambas columnas.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS program_activity JSONB DEFAULT NULL;

-- Objeto plano o NULL (mismo criterio que 079/077): un array o un escalar
-- suelto rompería el render de la card.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_program_activity_object;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_program_activity_object
  CHECK (program_activity IS NULL OR jsonb_typeof(program_activity) = 'object');

COMMENT ON COLUMN public.profiles.program_activity IS
  'Programa elegido a mano en Ajustes → Actividad: {kind:"app", title, app}. NULL = no comparte programa.';
