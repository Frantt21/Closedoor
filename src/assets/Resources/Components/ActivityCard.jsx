import { useEffect } from 'react';
import { FaMusic, FaTv, FaGamepad, FaSpotify } from 'react-icons/fa6';
import { useI18n } from '../../services/i18n/useI18n';
import { useAuth } from '../../../hooks/useAuth';
import { useLocalActivity, isLocalActivityAvailable } from '../../../hooks/useLocalActivity';
import {
  normalizeActivity,
  activityFromProfile,
  activitySignature,
  persistActivity,
} from '../../services/activityService';
import './css/activityCard.css';

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
 * La card NO se pinta si no hay actividad: un hueco vacío "sin actividad" solo
 * ocuparía sitio en el panel. Tampoco se pinta si el registro guardado tiene más
 * de ACTIVITY_TTL_MS (el equipo se apagó o la app se cerró sin limpiar).
 *
 * Además, en el perfil propio guarda los cambios en la fila del usuario para que
 * el resto los vea. Se hace aquí, junto a la lectura, para tener una sola fuente
 * de verdad y no duplicar el sondeo.
 */
export default function ActivityCard({ profile, isOwnProfile, surfaceStyle }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const localActivity = useLocalActivity();

  // Detección en vivo solo en tu propio perfil y solo si el puente del escritorio
  // está disponible (en el navegador no existe).
  const isLive = isOwnProfile && isLocalActivityAvailable();

  const activity = isLive ? normalizeActivity(localActivity) : activityFromProfile(profile);
  const signature = activitySignature(activity);

  // ~2,5 s de espera: deja que la primera lectura del bridge resuelva antes de
  // escribir nada (si no, el `null` inicial borraría la actividad que había) y
  // agrupa los cambios que llegan casi seguidos al cambiar de canción.
  useEffect(() => {
    if (!isLive || !user?.id) return undefined;
    const timer = setTimeout(() => {
      persistActivity(user.id, activity).catch((err) => {
        console.warn('[ActivityCard] No se pudo guardar la actividad:', err?.message || err);
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [isLive, user?.id, signature]);

  if (!activity) return null;

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
