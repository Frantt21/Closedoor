import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useI18n } from "../services/i18n/useI18n";
import { supabase } from "../services/supabaseclient";
import { listProfiles } from "../services/userService";
import {
  getFollowCounts,
  setCachedFollowStatus,
  getCachedExploreData,
  setCachedExploreData,
} from "../services/followService";
import FollowButton from "../Resources/Components/FollowButton";
import SafeImage from "../Resources/Components/SafeImage";
import Badge from "../Resources/Components/Badge";
import { FaLock } from 'react-icons/fa';
import "../Resources/Styles/explore.css";
import "../Resources/Styles/skeleton.css";

const DEFAULT_AVATAR =
  "https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg";

function Explore() {
  const { t, showAccent } = useI18n();
  const { user, loading: authLoading } = useAuth();

  // Lazy initializers: leen cache sincrónicamente durante el 1er render
  // Si hay cache, loading arranca en false y el skeleton nunca se muestra.
  // Si user?.id es undefined (auth cargando), la key será 'anon' → cache miss → skeleton.
  const [profiles, setProfiles] = useState(() => {
    const cached = getCachedExploreData(user?.id);
    return cached?.profiles || [];
  });
  const [countsMap, setCountsMap] = useState(() => {
    const cached = getCachedExploreData(user?.id);
    return cached?.counts || {};
  });
  const [loading, setLoading] = useState(() => {
    const cached = getCachedExploreData(user?.id);
    return !cached;
  });

  // ── Fetch initial data (profiles + counts + follow statuses) ──
  useEffect(() => {
    if (authLoading) return;

    const fetchAll = async () => {
      const cached = getCachedExploreData(user?.id);
      if (!cached) {
        setLoading(true);
      }

      try {
        const data = await listProfiles(user?.id);

        // Fetch follow counts + follow statuses en paralelo
        const [countsResults] = await Promise.all([
          Promise.allSettled(data.map((p) => getFollowCounts(p.id))),
          user?.id
            ? Promise.allSettled(
                data.map((p) =>
                  supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', user.id)
                    .eq('following_id', p.id)
                    .eq('status', 'accepted')
                    .maybeSingle()
                    .then(({ data: d }) => {
                      const status = !!d;
                      setCachedFollowStatus(user.id, p.id, status);
                    })
                )
              )
            : Promise.resolve([]),
        ]);

        const counts = {};
        data.forEach((p, i) => {
          counts[p.id] =
            countsResults[i]?.status === "fulfilled"
              ? countsResults[i].value
              : { followers: 0, following: 0 };
        });

        setProfiles(data);
        setCountsMap(counts);
        setCachedExploreData(user?.id, { profiles: data, counts });
      } catch (err) {
        console.warn("Error fetching profiles:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [user?.id, authLoading]);

  // ── Ref para acceder a profiles desde Realtime sin stale closures ──
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  // ── Realtime: refrescar counts cuando el usuario sigue/deja de seguir ──
  useEffect(() => {
    if (!user?.id) return;

    const refreshCounts = async () => {
      const current = profilesRef.current;
      if (current.length === 0) return;

      const results = await Promise.allSettled(
        current.map((p) => getFollowCounts(p.id))
      );

      // Construir desde cero (evita stale closure de countsMap)
      const updated = {};
      current.forEach((p, i) => {
        updated[p.id] =
          results[i]?.status === "fulfilled"
            ? results[i].value
            : { followers: 0, following: 0 };
      });

      setCountsMap(updated);
      // También actualizar el cache para que al volver a Explore los datos estén frescos
      setCachedExploreData(user.id, { profiles: current, counts: updated });
    };

    const channel = supabase
      .channel(`explore-counts-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'follows', filter: `follower_id=eq.${user.id}` },
        () => refreshCounts()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'follows', filter: `follower_id=eq.${user.id}` },
        () => refreshCounts()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'follows', filter: `following_id=eq.${user.id}` },
        () => refreshCounts()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'follows', filter: `following_id=eq.${user.id}` },
        () => refreshCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return (
    <div className="explore-page">
      <h1 className="explore-title">{t('explore.title')}</h1>
      <p className="explore-subtitle">{t('explore.subtitle')}</p>

      {loading ? (
        <div className="explore-skeleton-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="explore-skeleton-card">
              <div className="skeleton explore-skeleton-banner" />
              <div className="explore-skeleton-body">
                <div className="skeleton skeleton--circle explore-skeleton-avatar" />
                <div className="explore-skeleton-content">
                  <div className="skeleton explore-skeleton-name" />
                  <div className="skeleton explore-skeleton-count" />
                  <div className="skeleton explore-skeleton-bio-line" />
                  <div className="skeleton explore-skeleton-bio-line explore-skeleton-bio-line--short" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <div className="explore-empty">
          <p>{t('explore.no_results')}</p>
        </div>
      ) : (
        <div className="explore-grid">
          {profiles.map((profile) => (
            <ExploreCard
              key={profile.id}
              profile={profile}
              counts={countsMap[profile.id]}
              isOwnProfile={user?.id === profile.id}
              showAccent={showAccent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExploreCard({ profile, counts, isOwnProfile, showAccent }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const avatarUrl = profile.avatar_url || DEFAULT_AVATAR;
  const bio = profile.bio || "";
  const followers = counts?.followers ?? 0;
  const roles = profile.roles || ["user"];
  const hasAccent = showAccent && profile.accent_color;
  const cardStyle = hasAccent
    ? {
        '--accent-color': profile.accent_color,
        '--accent-color-2': profile.accent_color_secondary || profile.accent_color,
      }
    : {};

  const handleCardClick = useCallback((e) => {
    // Dont navigate if clicking inside the FollowButton area
    if (e.target.closest('.explore-card-action')) return;
    navigate(`/profile/${profile.username}`);
  }, [navigate, profile.username]);

  return (
    <div className={`explore-card${hasAccent ? ' explore-card--accent' : ''}`} style={cardStyle} onClick={handleCardClick}>
      <div className="explore-card-banner">
        {profile.banner_url && (
          <SafeImage
            className="explore-card-banner-img"
            src={profile.banner_url}
            alt=""
            style={{ objectPosition: profile.banner_position || '50% 50%' }}
          />
        )}
        <div className="explore-card-overlay" />
      </div>

      <div className="explore-card-body">
        <img
          className="explore-card-avatar"
          src={avatarUrl}
          alt={profile.username}
          style={{ objectPosition: profile.avatar_position || '50% 50%' }}
          onError={(e) => {
            e.target.src = DEFAULT_AVATAR;
          }}
        />

        <div className="explore-card-info">
          <div className="explore-card-name-row">
            <span className="explore-card-name">{profile.username}</span>
            {profile.is_private === true && (
              <span className="explore-card-private-icon" title={t('profile.private_profile')}>
                <FaLock />
              </span>
            )}
            <Badge roles={roles} />
          </div>

          <span className="explore-card-followers">
            {followers} {followers === 1 ? t('explore.followers_singular') : t('explore.followers_plural')}
          </span>

          {bio && <p className="explore-card-bio">{bio}</p>}
        </div>

        {!isOwnProfile && (
          <div className="explore-card-action">
            <FollowButton targetUserId={profile.id} />
          </div>
        )}
      </div>
    </div>
  );
}

export default Explore;
