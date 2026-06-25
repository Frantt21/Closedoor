import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { getUserProfile, getUserProfileByUsername, getCachedProfileByUsername, getCachedProfile } from '../../services/userService';
import { getTrendingHashtags, getTrendingWords, getCachedTrendingWords, getCachedTrendingHashtags } from '../../services/hashtagService';
import { getTrendingCategory } from '../../services/trendingDictionary';
import ProfileSidebar from './ProfileSidebar';
import { getContrastText, isUUID } from '../../services/helpers';
import { FaFire, FaHashtag } from 'react-icons/fa';
import './css/rightPanel.css';

const PROFILE_ROUTE = '/profile';
const PROFILE_ROUTE_PREFIX = '/profile/';

export default function RightPanel() {
  const { t } = useI18n();
  const location = useLocation();
  const { user, profile: ownProfile } = useAuth();
  const path = location.pathname.toLowerCase();

  // ── Sin sesión o auth pages: hidden ──
  if (!user || path === '/login' || path === '/register') return null;

  return (
    <aside className="right-panel">
      <ProfileContent path={path} ownProfile={ownProfile} user={user} t={t} />
    </aside>
  );
}

// ── Trending widget: dos secciones ──
function TrendingHashtags({ t, surfaceStyle }) {
  const [words, setWords] = useState(() => getCachedTrendingWords());
  const [hashtags, setHashtags] = useState(() => getCachedTrendingHashtags());

  useEffect(() => {
    Promise.all([
      getTrendingWords(6).then(setWords).catch(() => setWords([])),
      getTrendingHashtags(6).then(setHashtags).catch(() => setHashtags([])),
    ]);
  }, []);

  const isLoading = words === null || hashtags === null;
  const isEmpty = (!words?.length && !hashtags?.length);

  return (
    <div className="right-panel-card right-panel-card--noborder" style={surfaceStyle}>
      {isLoading ? (
        <div className="right-panel-trending-skeleton">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton right-panel-trending-pill" />
          ))}
        </div>
      ) : isEmpty ? (
        <p className="right-panel-placeholder">{t('right_panel.coming_soon')}</p>
      ) : (
        <>
          {/* ── Sección: Lo que se habla ── */}
          {words?.length > 0 && (
            <div className="right-panel-trending-section">
              <h4 className="right-panel-trending-subtitle">
                <FaFire className="right-panel-trending-subicon" />
                {t('right_panel.trending_words')}
              </h4>
              <div className="right-panel-trending-list">                  {words.slice(0, 5).map((item, i) => (
                  <Link
                    key={`word-${i}`}
                    to={`/hashtag/${encodeURIComponent(item.word)}?text=1`}
                    className="right-panel-trending-item"
                  >
                    <span className="right-panel-trending-category">{getTrendingCategory(item.word) || 'Varios'}</span>
                    <span className="right-panel-trending-item-row">
                      <span className="right-panel-trending-rank">#{i + 1}</span>
                      <span className="right-panel-trending-name">{item.word}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Sección: Hashtags populares ── */}
          {hashtags?.length > 0 && (
            <div className="right-panel-trending-section">
              <h4 className="right-panel-trending-subtitle">
                <FaHashtag className="right-panel-trending-subicon" />
                {t('right_panel.trending_hashtags')}
              </h4>
              <div className="right-panel-trending-list">                  {hashtags.slice(0, 5).map((item, i) => (
                  <Link
                    key={`hash-${i}`}
                    to={`/hashtag/${encodeURIComponent(item.name)}`}
                    className="right-panel-trending-item"
                  >
                    <span className="right-panel-trending-category">{getTrendingCategory(item.name) || 'Varios'}</span>
                    <span className="right-panel-trending-item-row">
                      <span className="right-panel-trending-rank">#{i + 1}</span>
                      <span className="right-panel-trending-name">{item.name}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Subcomponente que maneja la carga del perfil ──
function ProfileContent({ path, ownProfile, user, t }) {
  const isOwnProfilePage = path === PROFILE_ROUTE;
  const isOtherProfilePage = path.startsWith(PROFILE_ROUTE_PREFIX) && path.length > PROFILE_ROUTE_PREFIX.length;
  const isHomePage = path === '/';

  const [viewedProfile, setViewedProfile] = useState(() => {
    if (!isOtherProfilePage) return null;
    const username = path.replace(PROFILE_ROUTE_PREFIX, '');
    if (isUUID(username)) return getCachedProfile(username);
    return getCachedProfileByUsername(username);
  });
  const [loading, setLoading] = useState(() => {
    if (!isOtherProfilePage) return false;
    const username = path.replace(PROFILE_ROUTE_PREFIX, '');
    if (isUUID(username)) return !getCachedProfile(username);
    return !getCachedProfileByUsername(username);
  });

  useEffect(() => {
    if (!isOtherProfilePage) {
      setViewedProfile(null);
      setLoading(false);
      return;
    }

    const username = path.replace(PROFILE_ROUTE_PREFIX, '');
    if (!username) {
      setViewedProfile(null);
      setLoading(false);
      return;
    }

    // Si hay cache, mostrar inmediatamente (el refresh en background se hace desde profile.jsx)
    const hasCache = isUUID(username)
      ? getCachedProfile(username)
      : getCachedProfileByUsername(username);
    if (hasCache) {
      setViewedProfile(hasCache);
      setLoading(false);
      return;
    }

    setLoading(true);

    const fetchFn = isUUID(username)
      ? getUserProfile(username)
      : getUserProfileByUsername(username);

    fetchFn
      .then((profile) => setViewedProfile(profile))
      .catch(() => setViewedProfile(null))
      .finally(() => setLoading(false));
  }, [path, isOtherProfilePage, isUUID]);

  const { showAccent, accentVisibility, showTrending, showInterests, showProfileStats } = useI18n();

  // ── Home page y otras rutas no-perfil: trending siempre visible ──
  if (isHomePage || (!isOwnProfilePage && !isOtherProfilePage)) {
    return <TrendingHashtags t={t} />;
  }

  // ── Profile page ──
  const activeProfile = isOwnProfilePage ? ownProfile : viewedProfile;
  const isPrivate = activeProfile?.is_private === true;
  const statsPrivate = activeProfile?.stats_private === true;
  // statsVisibility directo desde el perfil (puede ser null = legacy)
  // El control individual se maneja en ProfileSidebar, y el toggle general
  // en Settings sincroniza stats_visibility automáticamente.
  const resolvedStatsVisibility = activeProfile?.stats_visibility ?? null;

  if (loading) {
    return (
      <div className="right-panel-card">
        <div className="skeleton right-panel-skeleton-title" />
        <div className="skeleton right-panel-skeleton-pill" style={{ width: '70%' }} />
        <div className="skeleton right-panel-skeleton-pill" style={{ width: '50%' }} />
        <div className="skeleton right-panel-skeleton-pill" style={{ width: '60%' }} />
      </div>
    );
  }

  if (!activeProfile) return null;

  const surfColor = activeProfile?.accent_surface_color;
  const surfGlass = activeProfile?.accent_surface_glass === true;
  const isOwnProfileRight = isOwnProfilePage;

  // Para perfiles ajenos: usar las preferencias guardadas en la BD del dueño del perfil
  // Para perfil propio: siempre mostrar (el toggle es para controlar qué ven los demás)
  const ownerShowAccentProfile = isOwnProfileRight
    ? true
    : (activeProfile?.show_accent_profile ?? true);
  const ownerAccentVisibility = isOwnProfileRight
    ? accentVisibility
    : (activeProfile?.accent_visibility ?? 'both');

  // Preferencias de visibilidad de cards:
  // - Perfil propio: usa la preferencia local (lo que el usuario configuró)
  // - Perfiles ajenos: usa la preferencia del DUEÑO del perfil (de Supabase)
  //   La preferencia local NO afecta lo que ves en perfiles ajenos
  const ownerShowInterests = isOwnProfileRight
    ? showInterests
    : (activeProfile?.show_interests ?? true);
  const ownerShowStats = isOwnProfileRight
    ? showProfileStats
    : (activeProfile?.show_profile_stats ?? true);
  const ownerShowTrending = isOwnProfileRight
    ? showTrending
    : (activeProfile?.show_trending ?? true);

  const accentVisibleRight = showAccent && ownerShowAccentProfile && (
    ownerAccentVisibility === 'both' ||
    (ownerAccentVisibility === 'me' && isOwnProfileRight) ||
    (ownerAccentVisibility === 'others' && !isOwnProfileRight)
  );
  const surfaceStyle = accentVisibleRight ? {
    '--accent-surface-rgba': surfGlass ? 'rgba(255, 255, 255, 0.04)' : (surfColor || 'var(--color-surface, #1a1a1a)'),
    '--accent-surface-rgba-hover': surfGlass ? 'rgba(255, 255, 255, 0.07)' : (surfColor ? `color-mix(in srgb, ${surfColor} 85%, #000)` : 'var(--color-surface-hover, #252525)'),
    '--accent-surface-blur': surfGlass ? 'blur(20px)' : 'none',
    '--accent-surface-border': surfGlass ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
    '--accent-surface-text-color': !surfGlass && surfColor ? getContrastText(surfColor) : 'var(--color-text, #ffffff)',
    '--accent-surface-text-secondary': !surfGlass && surfColor ? '#374151' : 'var(--color-text-secondary, #9ca3af)',
    '--accent-surface-text-muted': !surfGlass && surfColor ? '#6b7280' : 'var(--color-text-muted, #6b7280)',
  } : {};

  // Derive CSS vars from accent-surface-text-* for the containers
  const resolvedSurfaceStyle = Object.keys(surfaceStyle).length > 0 ? {
    ...surfaceStyle,
    '--color-text': surfaceStyle['--accent-surface-text-color'] || 'var(--color-text, #ffffff)',
    '--color-text-secondary': surfaceStyle['--accent-surface-text-secondary'] || 'var(--color-text-secondary, #9ca3af)',
    '--color-text-muted': surfaceStyle['--accent-surface-text-muted'] || 'var(--color-text-muted, #6b7280)',
  } : {};

  return (
    <>
      <ProfileSidebar
        profile={activeProfile}
        isPrivate={isPrivate}
        canViewContent={isOwnProfilePage || !isPrivate}
        statsVisibility={resolvedStatsVisibility}
        isOwnProfile={isOwnProfilePage}
        showInterests={ownerShowInterests}
        showStats={ownerShowStats}
        surfaceStyle={resolvedSurfaceStyle}
      />
      {ownerShowTrending && <TrendingHashtags t={t} surfaceStyle={resolvedSurfaceStyle} />}
    </>
  );
}
