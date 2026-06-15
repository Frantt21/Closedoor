import React, { useEffect, useState } from 'react';
import { FaLock, FaHeart, FaComment, FaRetweet, FaTags } from 'react-icons/fa';
import { useI18n } from '../../services/i18n/useI18n';
import { supabase } from '../../services/supabaseclient';
import './css/profileSidebar.css';

// ── Stats cache ──
const STATS_CACHE_PREFIX = 'fc_stats_';
const STATS_CACHE_TTL = 1000 * 60 * 5; // 5 minutos

function getCachedStats(profileId) {
  try {
    const raw = localStorage.getItem(STATS_CACHE_PREFIX + profileId);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > STATS_CACHE_TTL) {
      localStorage.removeItem(STATS_CACHE_PREFIX + profileId);
      return null;
    }
    return payload.stats;
  } catch {
    return null;
  }
}

function setCachedStats(profileId, stats) {
  try {
    const payload = { ts: Date.now(), stats };
    localStorage.setItem(STATS_CACHE_PREFIX + profileId, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export default function ProfileSidebar({ profile, isPrivate, canViewContent, canViewStats, isOwnProfile }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState(() => {
    if (!profile?.id) return null;
    if (!canViewStats && !isOwnProfile) return null;
    return getCachedStats(profile.id);
  });
  const interests = profile?.interests || [];
  const visibleInterests = expanded ? interests : interests.slice(0, 20);
  const hasMore = interests.length > 20;

  // ── Reset stats cuando cambia el perfil (navegación entre perfiles) ──
  useEffect(() => {
    if (profile?.id) {
      setStats(getCachedStats(profile.id));
    }
  }, [profile?.id]);

  // ── Fetch aggregated stats (cache-first, background-refresh) ──
  useEffect(() => {
    if (!profile?.id) return;

    const fetchStats = async () => {
      if (!canViewStats && !isOwnProfile) {
        setStats(null);
        return;
      }

      try {
        const { data: posts } = await supabase
          .from('posts')
          .select('likes_count, comments_count, reposts_count')
          .eq('user_id', profile.id);

        if (posts) {
          const total = posts.reduce(
            (acc, p) => ({
              likes: acc.likes + (p.likes_count || 0),
              comments: acc.comments + (p.comments_count || 0),
              reposts: acc.reposts + (p.reposts_count || 0),
            }),
            { likes: 0, comments: 0, reposts: 0 }
          );
          setStats(total);
          setCachedStats(profile.id, total);
        }
      } catch (err) {
        console.warn('Error fetching profile stats:', err);
      }
    };

    fetchStats();

    // ── Realtime: refrescar stats cuando se actualiza un post (like/comment/repost) ──
    const channel = supabase
      .channel(`profile-stats-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `user_id=eq.${profile.id}` },
        () => fetchStats()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `user_id=eq.${profile.id}` },
        () => fetchStats()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'posts', filter: `user_id=eq.${profile.id}` },
        () => fetchStats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, canViewStats, isOwnProfile]);

  if (!profile) return null;

  return (
    <aside className="profile-sidebar">
      {/* ── Interests ── */}
      <div className="profile-sidebar-card">
        <h3 className="profile-sidebar-title">
          <FaTags className="profile-sidebar-title-icon" />
          {t('profile.interests')}
        </h3>

        {!canViewContent && !isOwnProfile ? (
          <div className="profile-sidebar-private">
            <FaLock className="profile-sidebar-private-icon" />
            <span>{t('profile.private_interests_hidden')}</span>
          </div>
        ) : interests.length === 0 ? (
          <p className="profile-sidebar-empty">
            {isOwnProfile ? t('profile.no_interests_own') : t('profile.no_interests_other')}
          </p>
        ) : (
          <>
            <div className="profile-sidebar-interests">
              {visibleInterests.map((interest, i) => (
                <span key={i} className="profile-sidebar-interest-pill">
                  {interest}
                </span>
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                className="profile-sidebar-expand-btn"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? t('profile.show_less') : t('profile.show_more', { count: interests.length - 20 })}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Stats ── */}
      {canViewStats && (
        <div className="profile-sidebar-card">
          <h3 className="profile-sidebar-title">{t('profile.stats_title')}</h3>
          {!stats ? (
            <div className="profile-sidebar-stats-skeleton">
              <div className="skeleton profile-sidebar-skeleton-row" />
              <div className="skeleton profile-sidebar-skeleton-row" />
              <div className="skeleton profile-sidebar-skeleton-row" />
            </div>
          ) : (
            <div className="profile-sidebar-stats">
              <div className="profile-sidebar-stat">
                <FaHeart className="profile-sidebar-stat-icon profile-sidebar-stat-icon--likes" />
                <span className="profile-sidebar-stat-value">{stats.likes}</span>
                <span className="profile-sidebar-stat-label">{t('profile.stats_likes')}</span>
              </div>
              <div className="profile-sidebar-stat">
                <FaComment className="profile-sidebar-stat-icon profile-sidebar-stat-icon--comments" />
                <span className="profile-sidebar-stat-value">{stats.comments}</span>
                <span className="profile-sidebar-stat-label">{t('profile.stats_comments')}</span>
              </div>
              <div className="profile-sidebar-stat">
                <FaRetweet className="profile-sidebar-stat-icon profile-sidebar-stat-icon--reposts" />
                <span className="profile-sidebar-stat-value">{stats.reposts}</span>
                <span className="profile-sidebar-stat-label">{t('profile.stats_reposts')}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
