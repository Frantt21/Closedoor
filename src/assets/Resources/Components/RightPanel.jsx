import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { getUserProfile, getUserProfileByUsername, getCachedProfileByUsername, getCachedProfile } from '../../services/userService';
import ProfileSidebar from './ProfileSidebar';
import { FaFire } from 'react-icons/fa';
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
  if (isHomePage) {
    return (
      <div className="right-panel-card">
        <h3 className="right-panel-card-title">
          <FaFire className="right-panel-card-icon" />
          {t('right_panel.trending')}
        </h3>
        <p className="right-panel-placeholder">{t('right_panel.coming_soon')}</p>
      </div>
    );
  }

  // ── Other non-profile pages: mostrar igualmente el placeholder ──
  if (!isOwnProfilePage && !isOtherProfilePage) {
    return (
      <div className="right-panel-card">
        <h3 className="right-panel-card-title">
          <FaFire className="right-panel-card-icon" />
          {t('right_panel.trending')}
        </h3>
        <p className="right-panel-placeholder">{t('right_panel.coming_soon')}</p>
      </div>
    );
  }

  // ── Profile page ──
  const activeProfile = isOwnProfilePage ? ownProfile : viewedProfile;
  const isPrivate = activeProfile?.is_private === true;

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

  return (
    <ProfileSidebar
      profile={activeProfile}
      isPrivate={isPrivate}
      canViewContent={isOwnProfilePage || !isPrivate}
      isOwnProfile={isOwnProfilePage}
    />
  );
}
