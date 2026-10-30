import { useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { useLocalActivityState } from '../../../hooks/useLocalActivity';
import {
  normalizeActivity,
  activitySignature,
  persistActivity,
  recordActivity,
  shouldPublishActivity,
  getActivitySettings,
} from '../../services/activityService';

/**
 * ActivitySync — sincroniza lo que la app de escritorio detecta (música, vídeo,
 * juegos) con la cuenta y con el historial local. No pinta nada.
 *
 * Va montado a nivel de App (como FollowCountsWatcher), NO dentro del perfil, y
 * esa es la razón de existir: si la publicación colgara de la card del perfil, tu
 * actividad solo se guardaría mientras estuvieras mirando tu propio perfil, y tus
 * seguidores verían una foto vieja el resto del tiempo. Aquí corre durante toda la
 * sesión, estés donde estés.
 *
 * Responsabilidades:
 *   1. Publicar en `profiles.activity` para que los seguidores la vean (2,5 s de
 *      debounce para no escribir en cada sondeo del detector).
 *   2. Anotar cada cambio en el historial local del equipo (solo existe en la app
 *      de escritorio: en la web no hay detección).
 *
 * Respeta los ajustes de la categoría "Actividad" (migración 080): con
 * `activity_enabled = false` no se publica NI se registra historial; con
 * `visibility = 'nobody'` se sigue registrando el historial propio pero se deja la
 * fila limpia (`activity = NULL`), porque nadie más debe poder leerla.
 */
export default function ActivitySync() {
  const { user, profile } = useAuth();
  const { activity: liveActivity, ready } = useLocalActivityState();

  const activity = normalizeActivity(liveActivity);
  const signature = activitySignature(activity);
  const { enabled } = getActivitySettings(profile);
  const published = shouldPublishActivity(profile);

  // Historial local. Se espera a `ready` para no cerrar con el `null` del arranque
  // la entrada que quedó abierta la última vez.
  useEffect(() => {
    if (!ready || !user?.id || !enabled) return;
    recordActivity(user.id, activity);
  }, [ready, user?.id, enabled, signature]);

  // Publicación en la fila del perfil. Exige perfil cargado: con `profile` a null
  // no sabemos la visibilidad real, y publicar "por defecto" filtraría actividad de
  // una cuenta que la tiene en 'nobody'.
  useEffect(() => {
    if (!ready || !user?.id || !profile?.id || !enabled) return undefined;
    const timer = setTimeout(() => {
      persistActivity(user.id, published ? activity : null).catch((err) => {
        console.warn('[ActivitySync] No se pudo guardar la actividad:', err?.message || err);
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [ready, user?.id, profile?.id, enabled, published, signature]);

  return null;
}
