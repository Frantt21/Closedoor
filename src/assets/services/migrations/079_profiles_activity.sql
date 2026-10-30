-- ==============================================
-- Migration 079: Actividad local (música / vídeo / juegos) en el perfil
-- ==============================================
-- La app de escritorio detecta qué está sonando o qué juego está abierto
-- (desktop/activity.js → IPC → window.electron.activity) y el renderer lo
-- guarda aquí para que el resto de usuarios lo vea en el sidebar del perfil,
-- debajo de la card "Mi canción" (Resources/Components/ActivityCard.jsx).
--
-- Shape (lo normaliza services/activityService.js antes de escribir):
--   { "kind": "music"|"video"|"game",
--     "title": "...", "subtitle": "..."|null, "album": "..."|null,
--     "app": "Spotify"|"Steam"|..., "url": "..."|null }
--
-- activity_updated_at lo pone el cliente en la misma escritura. Sirve para
-- caducar el dato: si la app se cerró o el equipo se apagó sin limpiar la fila,
-- el registro se queda huérfano y el cliente lo ignora pasados 15 minutos
-- (ACTIVITY_TTL_MS) en vez de mostrar algo que ya no está pasando.
--
-- Sin GRANTs: la 071 dejó los privilegios a nivel TABLA (SELECT para anon y
-- authenticated; INSERT/UPDATE/DELETE para authenticated), así que las columnas
-- nuevas quedan legibles y escribibles sin tocar permisos. Las políticas RLS de
-- profiles siguen limitando la escritura a auth.uid() = id.
--
-- Sin índice: la actividad se lee siempre junto a la fila del perfil
-- (PROFILE_PUBLIC_COLUMNS), nunca se filtra ni se ordena por ella. Un índice
-- aquí solo costaría escrituras.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activity JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS activity_updated_at TIMESTAMPTZ DEFAULT NULL;

-- El contrato es un objeto plano (o NULL). Evita arrays/escalares sueltos que
-- romperían el render de la card (mismo criterio que 077 para shared_song).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_activity_object;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_activity_object
  CHECK (activity IS NULL OR jsonb_typeof(activity) = 'object');

COMMENT ON COLUMN public.profiles.activity IS
  'Actividad detectada por la app de escritorio: {kind, title, subtitle, album, app, url}. NULL = sin actividad.';
COMMENT ON COLUMN public.profiles.activity_updated_at IS
  'Última escritura de activity. El cliente oculta la actividad con más de 15 minutos.';
