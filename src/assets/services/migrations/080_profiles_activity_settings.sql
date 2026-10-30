-- ==============================================
-- Migration 080: controles de privacidad de la actividad
-- ==============================================
-- Añade la categoría "Actividad" de Ajustes. Dos ajustes por cuenta:
--
--   activity_enabled    → master switch. false = no se detecta nada, no se
--                         comparte nada y la app de escritorio no registra
--                         historial. También oculta la card en el perfil propio.
--   activity_visibility → quién ve la card en el perfil cuando está activada:
--                           'followers' → solo quien me sigue (por defecto)
--                           'nobody'    → nadie; sigo viéndola yo y se sigue
--                                         registrando el historial local
--
-- El valor por defecto es 'followers': es el ajuste más conservador, así que
-- ninguna cuenta existente empieza a mostrarse a todo el mundo sin decidirlo.
--
-- Implementación (importante para entender el modelo de confianza):
--   · 'nobody' se aplica EN EL DATO: el cliente deja `activity` a NULL y no
--     vuelve a escribirla, así que no hay nada que leer en la fila.
--   · 'followers' se aplica EN EL CLIENTE: se sigue guardando `activity` en la
--     fila (es la única forma de que un seguidor la lea sin otra tabla) y es el
--     render quien comprueba la relación. Cualquiera con acceso a la API y el id
--     del usuario podría leer esa columna, igual que ya pasa con el resto de
--     campos del perfil. Para enforcement real haría falta una tabla aparte con
--     RLS por relación de follows.
--
-- Sin GRANTs: la 071 dejó los privilegios a nivel TABLA (SELECT para anon y
-- authenticated; INSERT/UPDATE/DELETE para authenticated), así que las columnas
-- nuevas quedan legibles y escribibles solas. La RLS limita a auth.uid() = id.
--
-- Sin índice: se leen junto a la fila del perfil, nunca se filtran.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activity_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS activity_visibility TEXT NOT NULL DEFAULT 'followers';

-- Solo dos estados válidos. DROP + ADD para que la migración sea idempotente
-- aunque una versión anterior hubiera dejado otra definición.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_activity_visibility_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_activity_visibility_check
  CHECK (activity_visibility IN ('followers', 'nobody'));

COMMENT ON COLUMN public.profiles.activity_enabled IS
  'Compartir la actividad local (música/vídeo/juegos). false = no se detecta ni se guarda nada.';
COMMENT ON COLUMN public.profiles.activity_visibility IS
  'Quién ve la card de actividad: followers = solo quien me sigue, nobody = nadie.';
