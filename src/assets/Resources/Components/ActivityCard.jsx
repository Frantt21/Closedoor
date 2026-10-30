import { useEffect, useState } from 'react';
import { FaMusic, FaTv, FaGamepad, FaSpotify } from 'react-icons/fa6';
import { useI18n } from '../../services/i18n/useI18n';
import { useAuth } from '../../../hooks/useAuth';
import { useLocalActivityState, isLocalActivityAvailable } from '../../../hooks/useLocalActivity';
import { isFollowing, getCachedFollowStatus } from '../../services/followService';
import { resolveActivityArtwork } from '../../services/musicService';
import {
  normalizeActivity,
  activityFromProfile,
  getActivitySettings,
  canViewActivity,
} from '../../services/activityService';
import './css/activityCard.css';

/** ¿El visitante sigue al dueño del perfil? */

function useViewerIsFollower(viewerId, ownerId, skip) {
  const [isFollower, setIsFollower] = useState(() => {
    if (skip || !viewerId || !ownerId) return false;
    return getCachedFollowStatus(viewerId, ownerId) === true;
  });

  useEffect(() => {
    if (!skip && !viewerId && !ownerId) return undefined;

    let alive = true;
    const cached = getCachedFollowStatus(viewerId, ownerId);
    if (cached !== null && cached !== undefined) {
      return () => {
        alive = false;
      };
    }

    isFollowing(viewerId, ownerId)
      .then((value) => {
        if (alive) setIsFollower(value === true);
      })
      .catch(() => {
        if (alive) setIsFollower(false);
      });

    return () => {
      alive = false;
      isFollowing.cancel?.();
    };
  }, [skip, viewerId, ownerId]);

  return isFollower;
}

/** ActivityCard — qué está haciendo el usuario ahora mismo (música, vídeo o un juego),
 *  debajo de la card "Mi canción" del sidebar del perfil. */

export default function ActivityCard({ profile, isOwnProfile, surfaceStyle }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { activity: liveActivity } = useLocalActivityState();

  const { enabled, visibility } = getActivitySettings(profile);

  const isLive = isOwnProfile && enabled && isLocalActivityAvailable();
  const needsFollowerCheck = enabled && !isOwnProfile && visibility === 'followers';
  const viewerIsFollower = useViewerIsFollower(user?.id, profile?.id, !needsFollowerCheck);

  const visible = canViewActivity({ profile, isOwnProfile, viewerIsFollower });
  const storedActivity = activityFromProfile(profile);

  const activity = isLive ? normalizeActivity(liveActivity) : enabled ? storedActivity : null;

  const [artwork, setArtwork] = useState('');
  const artworkKey = activity && activity.kind === 'music'
    ? `${activity.title}\u0001${activity.subtitle || ''}`
    : '';

  useEffect(() => {
    let alive = true;
    if (!artworkKey) {
      return () => {
        alive = false;
      };
    }

    resolveActivityArtwork({ title: activity.title, artist: activity.subtitle || '' })
      .then((url) => {
        if (alive) setArtwork(url || '');
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [artworkKey]);

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
        <span className={`profile-activity-art ${artwork ? 'profile-activity-art--image' : ''}`} aria-hidden="true">
          {artwork ? (
            <img
              src={artwork}
              alt=""
              className="profile-activity-artwork"
              loading="lazy"
              draggable={false}
              onError={() => setArtwork('')}
            />
          ) : (
            <Icon />
          )}
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
        </div>
      </div>

    </div>
  );
}
