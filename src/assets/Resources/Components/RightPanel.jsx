import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { getUserProfile, getUserProfileByUsername, getCachedProfileByUsername, getCachedProfile } from '../../services/userService';
import { getTrendingHashtags, getTrendingWords, getCachedTrendingWords, getCachedTrendingHashtags } from '../../services/hashtagService';
import { getTrendingCategory } from '../../services/trendingDictionary';
import ProfileSidebar from './ProfileSidebar';
import { FaFire, FaHashtag } from 'react-icons/fa';
import './css/rightPanel.css';

// ── Detectar si un string es UUID ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(str) { return UUID_RE.test(str); }

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

// ── Helper: elegir texto blanco o negro según el brillo del color de fondo ──
function getContrastText(hex) {
  if (!hex) return '#000000';
  let r, g, b;
  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    return '#000000';
  }
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.179 ? '#000000' : '#ffffff';
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

  // ── Home page: placeholder de tendencias ──
  // ── Trending hashtags (shown on home page and non-profile pages) ──
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
  const { showAccent } = useI18n();
  const surfaceStyle = showAccent ? {
    '--accent-surface-rgba': surfGlass ? 'rgba(255, 255, 255, 0.04)' : (surfColor || 'var(--color-surface, #1a1a1a)'),
    '--accent-surface-rgba-hover': surfGlass ? 'rgba(255, 255, 255, 0.07)' : (surfColor ? `color-mix(in srgb, ${surfColor} 85%, #000)` : 'var(--color-surface-hover, #252525)'),
    '--accent-surface-blur': surfGlass ? 'blur(20px)' : 'none',
    '--accent-surface-border': surfGlass ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
    '--accent-surface-text-color': !surfGlass && surfColor ? getContrastText(surfColor) : 'var(--color-text, #ffffff)',
  } : {};

  return (
    <>
      <ProfileSidebar
        profile={activeProfile}
        isPrivate={isPrivate}
        canViewContent={isOwnProfilePage || !isPrivate}
        statsVisibility={resolvedStatsVisibility}
        isOwnProfile={isOwnProfilePage}
        surfaceStyle={surfaceStyle}
      />
      <TrendingHashtags t={t} surfaceStyle={surfaceStyle} />
    </>
  );
}
