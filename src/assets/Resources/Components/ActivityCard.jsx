import { useEffect, useState } from 'react';
import { FaMusic, FaTv, FaGamepad, FaSpotify } from 'react-icons/fa6';
import { useI18n } from '../../services/i18n/useI18n';
import { useAuth } from '../../../hooks/useAuth';
import { useLocalActivityState, isLocalActivityAvailable } from '../../../hooks/useLocalActivity';
import { isFollowing, getCachedFollowStatus } from '../../services/followService';
import {
  normalizeActivity,
  activityFromProfile,
  getActivitySettings,
  canViewActivity,
} from '../../services/activityService';
import './css/activityCard.css';

/**
 * ¿El visitante sigue al dueño del perfil?
 *
 * Solo se consulta cuando el dueño limitó la actividad a sus seguidores. Primero
 * el cache (`fc_fs_*`, 1 h) para pintar sin esperar, y si no hay, una consulta a
 * `follows`. `skip` deja el estado en false sin tocar la red.
 */
function useViewerIsFollower(viewerId, ownerId, skip) {
  const [isFollower, setIsFollower] = useState(() => {
    if (skip || !viewerId || !ownerId) return false;
    return getCachedFollowStatus(viewerId, ownerId) === true;
  });

  useEffect(() => {
    if (skip || !viewerId || !ownerId) {
      setIsFollower(false);
      return undefined;
    }
    const cached = getCachedFollowStatus(viewerId, ownerId);
    if (cached !== null && cached !== undefined) {
      setIsFollower(cached === true);
      return undefined;
    }
    let alive = true;
    isFollowing(viewerId, ownerId)
      .then((value) => {
        if (alive) setIsFollower(value === true);
      })
      .catch(() => {
        if (alive) setIsFollower(false);
      });
    return () => {
      alive = false;
    };
  }, [skip, viewerId, ownerId]);

  return isFollower;
}

/**
 * ActivityCard — qué está haciendo el usuario ahora mismo (música, vídeo o un
 * juego), debajo de la card "Mi canción" del sidebar del perfil.
 *
 * De dónde sale el dato:
 *   · Perfil propio EN LA APP DE ESCRITORIO → detección en vivo
 *     (window.electron.activity, ver desktop/activity.js). Es la única fuente
 *     fiable: si no suena nada, `null` y la card no se pinta.
 *   · Cualquier otro caso (perfil ajeno, o el propio desde el navegador) →
 *     `profiles.activity`, lo último que guardó su dueño desde el escritorio.
 *
 * Los ajustes de la categoría "Actividad" de Ajustes (migración 080) mandan:
 *   · `activity_enabled = false` → no se muestra en ningún sitio.
 *   · `activity_visibility = 'followers'` → solo lo ven quienes le siguen.
 *   · `activity_visibility = 'nobody'` → solo lo ve el dueño; y como no se
 *     publica, su fila queda con `activity` a NULL.
 *
 * La card NO se pinta si no hay actividad: un hueco vacío "sin actividad" solo
 * ocuparía sitio en el panel. Tampoco se pinta si el registro guardado tiene más
 * de ACTIVITY_TTL_MS (el equipo se apagó o la app se cerró sin limpiar).
 *
 * La card SOLO pinta. Publicar la actividad en la fila y escribir el historial lo
 * hace ActivitySync, montado a nivel de App, para que funcione sin depender de que
 * el usuario esté mirando su propio perfil.
 */
export default function ActivityCard({ profile, isOwnProfile, surfaceStyle }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { activity: liveActivity } = useLocalActivityState();

  const { enabled, visibility } = getActivitySettings(profile);

  // Detección en vivo solo en tu propio perfil, solo con el puente del escritorio
  // y solo si no apagaste la actividad. Si está apagada no se muestra nada.
  const isLive = isOwnProfile && enabled && isLocalActivityAvailable();
  const needsFollowerCheck = enabled && !isOwnProfile && visibility === 'followers';
  const viewerIsFollower = useViewerIsFollower(user?.id, profile?.id, !needsFollowerCheck);

  const visible = canViewActivity({ profile, isOwnProfile, viewerIsFollower });
  const storedActivity = activityFromProfile(profile);

  const activity = isLive ? normalizeActivity(liveActivity) : enabled ? storedActivity : null;

  if (!visible || !activity) return null;

  const isGame = activity.kind === 'game';
  const isVideo = activity.kind === 'video';
  const Icon = isGame ? FaGamepad : isVideo ? FaTv : activity.app === 'Spotify' ? FaSpotify : FaMusic;

  const label = isGame
    ? t('profile.activity_playing_game')
    : isVideo
      ? t('profile.activity_watching')
      : t('profile.activity_listening');

  return (
    <div className="profile-sidebar-card profile-activity-card" style={surfaceStyle}>
      <h3 className="profile-sidebar-title">
        <Icon className="profile-sidebar-title-icon" />
        {label}
      </h3>

      <div className="profile-activity-row">
        <span className="profile-activity-art" aria-hidden="true">
          <Icon />
          {!isGame && (
            <span className="profile-activity-bars">
              <i />
              <i />
              <i />
            </span>
          )}
        </span>

        <div className="profile-activity-meta">
          <span className="profile-activity-title" title={activity.title}>
            {activity.title}
          </span>
          {activity.subtitle && (
            <span className="profile-activity-subtitle" title={activity.subtitle}>
              {activity.subtitle}
            </span>
          )}
          {activity.app && (
            <span className="profile-activity-app" title={activity.app}>
              {activity.app}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
