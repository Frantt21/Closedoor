import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../services/supabaseclient";
import {
    updateUserProfile,
    updateAuthUserMetadata,
    isUsernameAvailable,
    getUserProfileByUsername,
    getUserProfile,
    setCachedProfile,
    setCachedProfileByUsername,
    getCachedProfileByUsername,
    getCachedProfile,
} from "../services/userService";
import {
    getFollowCounts,
    setCachedFollowCounts,
    getCachedFollowCounts,
    isFollowing,
    setCachedFollowStatus,
    getCachedFollowStatus,
} from "../services/followService";
import {
    getProfileContent,
    getLikedPostIds,
    getRepostedPostIds,
    getSavedPostIds,
    getSavedPosts,
    setCachedFeed,
    getCachedFeed,
    clearFeedCache,
    sortProfilePosts,
    clearVisibleIdsCache,
} from "../services/postService";
import "../Resources/Styles/profiles.css";
import "../Resources/Styles/skeleton.css";
import "../Resources/Styles/post.css";
import Modal from "../Resources/Components/Modal";
import Badge from "../Resources/Components/Badge";
import { getPlatformIcon, getPlatformName } from "../services/socialPlatforms";
import { FaFeather, FaBookmark, FaLock } from 'react-icons/fa';
import FollowButton from "../Resources/Components/FollowButton";
import { useI18n } from "../services/i18n/useI18n";
import FollowersModal from "../Resources/Components/FollowersModal";
import PostCard from "../Resources/Components/PostCard";
import CreatePostModal from "../Resources/Components/CreatePostModal";

// ── Detectar si un string es UUID ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUUID(str) { return UUID_RE.test(str); }

// ── Helper: elegir texto blanco o negro según el brillo del color de fondo ──
function getContrastText(hex) {
  if (!hex) return '#000000';
  // Convertir hex a RGB
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
  // WCAG relative luminance
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

function Profile() {
    const { t, showAccent } = useI18n();
    const { username: profileUsername } = useParams();
    const navigate = useNavigate();
    const { user, profile: ownProfile, refreshProfile, isAuthenticated } = useAuth();

    const isOwnProfile = !profileUsername || profileUsername === ownProfile?.username;

    const [viewedProfile, setViewedProfile] = useState(() => {
        if (isOwnProfile) return null;
        const cached = isUUID(profileUsername)
            ? getCachedProfile(profileUsername)
            : getCachedProfileByUsername(profileUsername);
        return cached || null;
    });
    const [viewedProfileLoading, setViewedProfileLoading] = useState(() => {
        if (isOwnProfile) return false;
        const cached = isUUID(profileUsername)
            ? getCachedProfile(profileUsername)
            : getCachedProfileByUsername(profileUsername);
        return !cached;
    });
    const [profileError, setProfileError] = useState(null);

    const activeProfile = isOwnProfile ? ownProfile : viewedProfile;
    const isPrivate = activeProfile?.is_private === true;

    // ── Obtener userId incluso cuando activeProfile aún no cargó ──
    const resolveUserId = () => {
        if (activeProfile?.id) return activeProfile.id;
        if (profileUsername && !isOwnProfile) {
            const cached = isUUID(profileUsername)
                ? getCachedProfile(profileUsername)
                : getCachedProfileByUsername(profileUsername);
            if (cached) return cached.id;
        }
        return null;
    };
    const resolvedUserId = resolveUserId();

    const [isFollower, setIsFollower] = useState(() => {
        const targetId = activeProfile?.id || resolveUserId();
        if (user?.id && targetId && !isOwnProfile) {
            return getCachedFollowStatus(user.id, targetId) ?? null;
        }
        return null;
    });
    const [isFollowedBy, setIsFollowedBy] = useState(() => {
        // Si el perfil visitado sigue al usuario actual
        const targetId = activeProfile?.id || resolveUserId();
        if (user?.id && targetId && !isOwnProfile) {
            return getCachedFollowStatus(targetId, user.id) ?? null;
        }
        return null;
    });
    const canViewContent = isOwnProfile || !isPrivate || isFollower === true;

    const [followCounts, setFollowCounts] = useState(() => {
        const targetId = activeProfile?.id || resolveUserId();
        const cached = targetId ? getCachedFollowCounts(targetId) : null;
        return cached || null;
    });
    const [countsLoading, setCountsLoading] = useState(() => {
        const targetId = activeProfile?.id || resolveUserId();
        return targetId ? !getCachedFollowCounts(targetId) : true;
    });

    // ── Fetch other user's profile (refresh en background) ──
    useEffect(() => {
        if (isOwnProfile) {
            setViewedProfile(null);
            setProfileError(null);
            return;
        }

        const isUuidParam = isUUID(profileUsername);
        // Cache ya se leyó en useState — solo fetch en background para refrescar

        const loadProfile = async () => {
            setProfileError(null);
            try {
                const userProfile = isUuidParam
                    ? await getUserProfile(profileUsername)
                    : await getUserProfileByUsername(profileUsername);
                if (!userProfile) {
                    setProfileError(t('profile.not_found'));
                    setViewedProfile(null);
                } else {
                    setViewedProfile(userProfile);
                    setCachedProfile(userProfile);
                    if (!isUuidParam) {
                        setCachedProfileByUsername(profileUsername, userProfile);
                    }
                }
            } catch (err) {
                setProfileError(t('common.error'));
                setViewedProfile(null);
            } finally {
                setViewedProfileLoading(false);
            }
        };

        loadProfile();
    }, [profileUsername, isOwnProfile, t]);

    // ── Fetch follow counts + suscripción Realtime para actualización en vivo ──
    useEffect(() => {
        const userId = activeProfile?.id;
        if (!userId) return;

        const refreshCounts = () => {
            getFollowCounts(userId)
                .then((counts) => {
                    setFollowCounts(counts);
                    setCachedFollowCounts(userId, counts);
                    setCountsLoading(false);
                })
                .catch((err) => {
                    console.warn("Error refreshing follow counts:", err);
                    setCountsLoading(false);
                });
        };

        // Restaurar cache inmediatamente (síncrono)
        const cached = getCachedFollowCounts(userId);
        setFollowCounts(cached || null);
        setCountsLoading(!cached);

        // Fetch inicial en segundo plano
        refreshCounts();

        // Suscripción Realtime: actualiza en vivo cuando hay cambios
        const channel = supabase
            .channel(`profile-counts-${userId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'follows', filter: `following_id=eq.${userId}` },
                () => refreshCounts()
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'follows', filter: `following_id=eq.${userId}` },
                () => refreshCounts()
            )
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'follows', filter: `follower_id=eq.${userId}` },
                () => refreshCounts()
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'follows', filter: `follower_id=eq.${userId}` },
                () => refreshCounts()
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeProfile?.id]);

    // ── Check if current user follows this profile (solo una vez, cache + Realtime) ──
    useEffect(() => {
        if (!user?.id || !activeProfile?.id || isOwnProfile) {
            setIsFollower(null);
            return;
        }

        // Cache: si ya existe, usarlo sin re-consultar
        const cached = getCachedFollowStatus(user.id, activeProfile.id);
        if (cached !== null) {
            setIsFollower(cached);
            return;
        }

        // Primera vez: consultar y cachear
        isFollowing(user.id, activeProfile.id)
            .then((status) => {
                setIsFollower(status);
                setCachedFollowStatus(user.id, activeProfile.id, status);
            })
            .catch((err) => {
                console.warn('Error checking follower status:', err);
                setIsFollower(false);
            });
    }, [user?.id, activeProfile?.id, isOwnProfile]);

    // ── Check if this profile follows the current user ("Te sigue") ──
    useEffect(() => {
        if (!user?.id || !activeProfile?.id || isOwnProfile) {
            setIsFollowedBy(null);
            return;
        }

        const cached = getCachedFollowStatus(activeProfile.id, user.id);
        if (cached !== null) {
            setIsFollowedBy(cached);
            return;
        }

        isFollowing(activeProfile.id, user.id)
            .then((status) => {
                setIsFollowedBy(status);
                setCachedFollowStatus(activeProfile.id, user.id, status);
            })
            .catch((err) => {
                console.warn('Error checking if profile follows you:', err);
                setIsFollowedBy(false);
            });
    }, [user?.id, activeProfile?.id, isOwnProfile]);

    // ── Realtime: escuchar cambios en el estado de follow ──
    useEffect(() => {
        if (!user?.id || !activeProfile?.id || isOwnProfile) return;

        const channel = supabase
            .channel(`follow-status-${user.id}-${activeProfile.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'follows',
                    filter: `follower_id=eq.${user.id}`,
                },
                async (payload) => {
                    const affectedId = payload.new?.following_id || payload.old?.following_id;
                    if (affectedId !== activeProfile.id) return;

                    try {
                        const { data, error } = await supabase
                            .from('follows')
                            .select('follower_id')
                            .eq('follower_id', user.id)
                            .eq('following_id', activeProfile.id)
                            .eq('status', 'accepted')
                            .maybeSingle();

                        if (!error) {
                            const isNowFollowing = !!data;
                            setIsFollower(isNowFollowing);
                            setCachedFollowStatus(user.id, activeProfile.id, isNowFollowing);
                        }
                    } catch (err) {
                        console.warn('Error in follow status Realtime handler:', err);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user?.id, activeProfile?.id, isOwnProfile]);

    // ── Realtime: escuchar cambios en el perfil (is_private, avatar, bio, etc.) ──
    useEffect(() => {
        const targetId = activeProfile?.id;
        if (!targetId || isOwnProfile) return;

        const channel = supabase
            .channel(`profile-updates-${targetId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${targetId}`,
                },
                (payload) => {
                    const updated = payload.new;
                    const merged = { ...activeProfile, ...updated };

                    // Actualizar estado y cache con los nuevos datos
                    setViewedProfile(merged);
                    setCachedProfile(merged);
                    if (profileUsername && !isUUID(profileUsername)) {
                        setCachedProfileByUsername(profileUsername, merged);
                    }

                    // Si cambió is_private, refrescar cache del feed
                    const prevIsPrivate = payload.old?.is_private === true;
                    const newIsPrivate = updated?.is_private === true;
                    if (prevIsPrivate !== newIsPrivate) {
                        clearVisibleIdsCache(user?.id);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeProfile?.id, profileUsername, user?.id, isOwnProfile]);

    // ── Followers modal state ──
    const [followersModal, setFollowersModal] = useState({ open: false, type: "followers" });

    const openFollowersModal = (type) => {
        if (activeProfile?.id && canViewContent) {
            setFollowersModal({ open: true, type });
        }
    };

    const closeFollowersModal = () => {
        setFollowersModal({ open: false, type: "followers" });
        // Refresh counts + cache when modal closes
        if (activeProfile?.id) {
            getFollowCounts(activeProfile.id)
                .then((counts) => {
                    setFollowCounts(counts);
                    setCachedFollowCounts(activeProfile.id, counts);
                })
                .catch((err) => console.warn("Error refreshing follow counts:", err));
        }
    };

    // ── Posts state (con cache, usando resolvedUserId aunque activeProfile sea null) ──
    const cacheKey = resolvedUserId ? `profile_posts_${resolvedUserId}` : null;
    const getCachedPosts = () => (cacheKey ? getCachedFeed(cacheKey) : null);
    const [profilePosts, setProfilePosts] = useState(() => getCachedPosts()?.items || []);
    const [likedPostIds, setLikedPostIds] = useState(() => getCachedPosts()?.likedIds || []);
    const [repostedPostIds, setRepostedPostIds] = useState(() => getCachedPosts()?.repostedIds || []);
    const [savedPostIds, setSavedPostIds] = useState(() => getCachedPosts()?.savedIds || []);
    const [postsLoading, setPostsLoading] = useState(() => !getCachedPosts());
    const [showCreatePost, setShowCreatePost] = useState(false);
    const [editingPost, setEditingPost] = useState(null);
    const [tab, setTab] = useState('posts'); // 'posts' | 'saved'
    // Resetear a 'posts' al navegar a un perfil ajeno
    useEffect(() => {
        if (!isOwnProfile) setTab('posts');
    }, [isOwnProfile]);
    const savedCacheKey = user?.id ? `saved_posts_${user.id}` : null;
    const [savedPosts, setSavedPosts] = useState(() => {
        const cached = savedCacheKey ? getCachedFeed(savedCacheKey) : null;
        return cached?.items || [];
    });
    const [savedLikedIds, setSavedLikedIds] = useState(() => {
        const cached = savedCacheKey ? getCachedFeed(savedCacheKey) : null;
        return cached?.likedIds || [];
    });
    const [savedRepostedIds, setSavedRepostedIds] = useState(() => {
        const cached = savedCacheKey ? getCachedFeed(savedCacheKey) : null;
        return cached?.repostedIds || [];
    });
    const [savedPostsLoading, setSavedPostsLoading] = useState(() => {
        const cached = savedCacheKey ? getCachedFeed(savedCacheKey) : null;
        return !cached;
    });

    // ── Fetch posts + reposts for active profile (con cache) ──
    useEffect(() => {
        const userId = activeProfile?.id;
        if (!userId || !canViewContent) return;

        const newCacheKey = `profile_posts_${userId}`;
        const cached = getCachedFeed(newCacheKey);
        if (cached) {
            setProfilePosts(cached.items || []);
            setLikedPostIds(cached.likedIds || []);
            setRepostedPostIds(cached.repostedIds || []);
            setSavedPostIds(cached.savedIds || []);
            setPostsLoading(false);
        } else {
            setPostsLoading(true);
        }

        const loadPosts = async () => {
            try {
                const items = await getProfileContent(userId, user?.id);
                setProfilePosts(items);
                // Batch check likes/reposts/saves for current user
                let likedIds = [], repostedIds = [], savedIds = [];
                if (user?.id && items.length > 0) {
                    const postIds = items.map((p) => p.id);
                    [likedIds, repostedIds, savedIds] = await Promise.all([
                        getLikedPostIds(postIds, user.id),
                        getRepostedPostIds(postIds, user.id),
                        getSavedPostIds(postIds, user.id),
                    ]);
                    setLikedPostIds(likedIds);
                    setRepostedPostIds(repostedIds);
                    setSavedPostIds(savedIds);
                }
                setCachedFeed(`profile_posts_${userId}`, items, likedIds, repostedIds, savedIds);
            } catch (err) {
                console.error('Error loading posts:', err);
            } finally {
                setPostsLoading(false);
            }
        };

        loadPosts();
    }, [activeProfile?.id, activeProfile?.username, user?.id, canViewContent]);

    // ── Realtime: listen for new posts on this profile ──
    useEffect(() => {
        const userId = activeProfile?.id;
        if (!userId || !canViewContent) return;

        const refreshAfterChange = async () => {
            try {
                const items = await getProfileContent(userId, user?.id);
                setProfilePosts(items);
                let likedIds = [], repostedIds = [], savedIds = [];
                if (user?.id && items.length > 0) {
                    const postIds = items.map((p) => p.id);
                    [likedIds, repostedIds, savedIds] = await Promise.all([
                        getLikedPostIds(postIds, user.id),
                        getRepostedPostIds(postIds, user.id),
                        getSavedPostIds(postIds, user.id),
                    ]);
                    setLikedPostIds(likedIds);
                    setRepostedPostIds(repostedIds);
                    setSavedPostIds(savedIds);
                }
                setCachedFeed(`profile_posts_${userId}`, items, likedIds, repostedIds, savedIds);
            } catch (err) {
                console.warn('Error refreshing after change:', err);
            }
        };

        const channel = supabase
            .channel(`profile-posts-${userId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'posts', filter: `user_id=eq.${userId}` },
                () => refreshAfterChange()
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'posts', filter: `user_id=eq.${userId}` },
                () => refreshAfterChange()
            )
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'reposts', filter: `user_id=eq.${userId}` },
                () => refreshAfterChange()
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'reposts', filter: `user_id=eq.${userId}` },
                () => refreshAfterChange()
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'posts', filter: `user_id=eq.${userId}` },
                (payload) => {
                    // Actualización en vivo de contadores Y pin state
                    const updated = payload.new;
                    setProfilePosts((prev) => {
                        const mapped = prev.map((p) =>
                            p.id === updated.id
                                ? { ...p, likes_count: updated.likes_count, reposts_count: updated.reposts_count, comments_count: updated.comments_count, is_pinned: updated.is_pinned, pinned_at: updated.pinned_at }
                                : p
                        );
                        return [...mapped].sort(sortProfilePosts);
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeProfile?.id, user?.id, canViewContent]);

    // ── Load saved posts (con cache + background refresh) ──
    useEffect(() => {
        if (!user?.id) return;
        const cacheKey = `saved_posts_${user.id}`;

        // Restaurar cache inmediatamente (síncrono)
        const cached = getCachedFeed(cacheKey);
        if (cached) {
            setSavedPosts(cached.items || []);
            setSavedLikedIds(cached.likedIds || []);
            setSavedRepostedIds(cached.repostedIds || []);
            setSavedPostsLoading(false);
        } else {
            setSavedPostsLoading(true);
        }

        // Fetch en segundo plano
        const loadSaved = async () => {
            try {
                const items = await getSavedPosts(user.id);
                setSavedPosts(items);
                // Check liked/reposted state for these posts
                let likedIds = [], repostedIds = [];
                if (items.length > 0) {
                    const postIds = items.map((p) => p.id);
                    [likedIds, repostedIds] = await Promise.all([
                        getLikedPostIds(postIds, user.id),
                        getRepostedPostIds(postIds, user.id),
                    ]);
                    setSavedLikedIds(likedIds);
                    setSavedRepostedIds(repostedIds);
                }
                setCachedFeed(cacheKey, items, likedIds, repostedIds, []);
            } catch (err) {
                console.error('Error loading saved posts:', err);
            } finally {
                setSavedPostsLoading(false);
            }
        };

        loadSaved();
    }, [user?.id]);

    // ── Refetch liked/reposted IDs al cambiar a Saved tab ──
    useEffect(() => {
        if (tab !== 'saved' || !user?.id) return;
        const postIds = savedPosts.map((p) => p.id);
        if (postIds.length === 0) return;
        (async () => {
            try {
                const [likedIds, repostedIds] = await Promise.all([
                    getLikedPostIds(postIds, user.id),
                    getRepostedPostIds(postIds, user.id),
                ]);
                setSavedLikedIds(likedIds);
                setSavedRepostedIds(repostedIds);
                setCachedFeed(`saved_posts_${user.id}`, savedPosts, likedIds, repostedIds, []);
            } catch (err) {
                console.warn('Error refreshing saved liked/reposted status:', err);
            }
        })();
    }, [tab, user?.id]);

    // ── Handlers for like/repost sync ──
    const handleLikeToggle = (postId, nowLiked) => {
      setLikedPostIds((prev) =>
        nowLiked ? [...prev, postId] : prev.filter((id) => id !== postId)
      );
      setSavedLikedIds((prev) =>
        nowLiked ? [...prev, postId] : prev.filter((id) => id !== postId)
      );
      // Sincronizar likes_count en ambos arrays
      const delta = nowLiked ? 1 : -1;
      setProfilePosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, likes_count: Math.max((p.likes_count || 0) + delta, 0) }
            : p
        )
      );
      setSavedPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, likes_count: Math.max((p.likes_count || 0) + delta, 0) }
            : p
        )
      );
    };

    const handleRepostToggle = (postId, nowReposted) => {
      setRepostedPostIds((prev) =>
        nowReposted ? [...prev, postId] : prev.filter((id) => id !== postId)
      );
      setSavedRepostedIds((prev) =>
        nowReposted ? [...prev, postId] : prev.filter((id) => id !== postId)
      );
      // Sincronizar reposts_count en ambos arrays
      const delta = nowReposted ? 1 : -1;
      setProfilePosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, reposts_count: Math.max((p.reposts_count || 0) + delta, 0) }
            : p
        )
      );
      setSavedPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, reposts_count: Math.max((p.reposts_count || 0) + delta, 0) }
            : p
        )
      );
    };

    // ── Handlers for post actions ──
    const handlePostCreated = async () => {
        const userId = activeProfile?.id;
        if (!userId) return;
        try {
            const items = await getProfileContent(userId, user?.id);
            setProfilePosts(items);
            let likedIds = [], repostedIds = [], savedIds = [];
            if (user?.id && items.length > 0) {
                const postIds = items.map((p) => p.id);
                [likedIds, repostedIds, savedIds] = await Promise.all([
                    getLikedPostIds(postIds, user.id),
                    getRepostedPostIds(postIds, user.id),
                    getSavedPostIds(postIds, user.id),
                ]);
                setLikedPostIds(likedIds);
                setRepostedPostIds(repostedIds);
                setSavedPostIds(savedIds);
            }
            setCachedFeed(`profile_posts_${userId}`, items, likedIds, repostedIds, savedIds);
        } catch (err) {
            console.error('Error refreshing posts:', err);
        }
    };

    const handlePostUpdate = (updatedPost) => {
        if (updatedPost._editing) {
            setEditingPost(updatedPost);
            setShowCreatePost(true);
            return;
        }
        setProfilePosts((prev) => {
            const updated = prev.map((p) =>
                p.id === updatedPost.id ? { ...p, ...updatedPost } : p
            );
            return [...updated].sort(sortProfilePosts);
        });
    };

    const handlePostDelete = (postId) => {
        setProfilePosts((prev) => prev.filter((p) => p.id !== postId));
    };

    // ── Sincronizar saved state desde PostCard ──
    const handleSaveToggle = (postId, nowSaved) => {
        // Actualizar savedPostIds inmediatamente (para icono bookmark en Posts tab)
        setSavedPostIds((prev) =>
            nowSaved ? [...prev, postId] : prev.filter((id) => id !== postId)
        );
        // Refrescar la lista de guardados en background, incluyendo liked/reposted IDs
        if (user?.id && nowSaved) {
            (async () => {
                try {
                    const items = await getSavedPosts(user.id);
                    setSavedPosts(items);
                    if (items.length > 0) {
                        const postIds = items.map((p) => p.id);
                        const [likedIds, repostedIds] = await Promise.all([
                            getLikedPostIds(postIds, user.id),
                            getRepostedPostIds(postIds, user.id),
                        ]);
                        setSavedLikedIds(likedIds);
                        setSavedRepostedIds(repostedIds);
                        setCachedFeed(`saved_posts_${user.id}`, items, likedIds, repostedIds, []);
                    }
                } catch (err) {
                    console.warn('Error refreshing saved posts:', err);
                }
            })();
        } else if (user?.id && !nowSaved) {
            // Quitar de savedPosts sin refetch
            setSavedPosts((prev) => prev.filter((p) => p.id !== postId));
            // También remover el postId de savedLikedIds/savedRepostedIds
            setSavedLikedIds((prev) => prev.filter((id) => id !== postId));
            setSavedRepostedIds((prev) => prev.filter((id) => id !== postId));
        }
    };

    // ── Re-fetch counts when follow changes ──
    const handleFollowChange = () => {
        if (activeProfile?.id) {
            getFollowCounts(activeProfile.id)
                .then((counts) => {
                    setFollowCounts(counts);
                    setCachedFollowCounts(activeProfile.id, counts);
                    setCountsLoading(false);
                })
                .catch((err) => {
                    console.warn("Error refreshing follow counts:", err);
                    setCountsLoading(false);
                });
        }
    };

    // ── Edit modal state (own profile only) ──
    // ── Edit modal state (own profile only) ──
    const [showModal, setShowModal] = useState(false);
    const [modalUsername, setModalUsername] = useState("");
    const [modalBanner, setModalBanner] = useState("");
    const [modalAvatar, setModalAvatar] = useState("");
    const [modalBio, setModalBio] = useState("");
    const [modalSocialLinks, setModalSocialLinks] = useState([]);
    const [modalAccentColor, setModalAccentColor] = useState('');
    const [modalInterests, setModalInterests] = useState([]);
    const [usernameInput, setUsernameInput] = useState("");
    const [avatarInput, setAvatarInput] = useState("");
    const [bannerInput, setBannerInput] = useState("");
    const [message, setMessage] = useState(null);
    const [localError, setLocalError] = useState(null);

    // ── Auto-dismiss messages after 5 seconds ──
    useEffect(() => {
        if (!message && !localError) return;
        const timer = setTimeout(() => {
            setMessage(null);
            setLocalError(null);
        }, 5000);
        return () => clearTimeout(timer);
    }, [message, localError]);

    useEffect(() => {
        if (isOwnProfile) {
            setUsernameInput(ownProfile?.username || user?.user_metadata?.username || "");
            setAvatarInput(ownProfile?.avatar_url || "");
            setBannerInput(ownProfile?.banner_url || "");
            setModalSocialLinks(ownProfile?.social_links || []);
            setModalAccentColor(ownProfile?.accent_color || '');
        }
    }, [ownProfile, user, isOwnProfile]);

    const avatarUrl = activeProfile?.avatar_url || null;
    const bannerUrl = activeProfile?.banner_url || null;
    const profileDisplayName =
        activeProfile?.username ||
        user?.user_metadata?.display_name ||
        user?.user_metadata?.displayname ||
        user?.user_metadata?.username ||
        user?.email?.split("@")[0] ||
        "Guest";

    const roles = activeProfile?.roles || ["user"];

    // ── Save profile (own profile only) ──
    const handleSaveProfile = async ({ username, avatar_url, banner_url, bio, social_links, accent_color, interests }) => {
        setLocalError(null);
        setMessage(null);
        if (!user?.id) return;

        const normalizedUsername = (username || "").trim().toLowerCase();
        if (!normalizedUsername || normalizedUsername.length < 3) {
            setLocalError(t('profile.username_short'));
            return;
        }

        try {
            if (normalizedUsername !== ownProfile?.username) {
                const available = await isUsernameAvailable(normalizedUsername, user.id);
                if (!available) {
                    setLocalError(t('profile.username_taken'));
                    return;
                }
            }

            const updates = {
                avatar_url: avatar_url || null,
                banner_url: banner_url || null,
                bio: bio || null,
                social_links: social_links || [],
                accent_color: accent_color || null,
                interests: interests || [],
            };

            if (normalizedUsername !== ownProfile?.username) {
                updates.username = normalizedUsername;
            }

            await updateUserProfile(user.id, updates);

            if (normalizedUsername !== ownProfile?.username) {
                try {
                    await updateAuthUserMetadata({
                        username: normalizedUsername,
                        display_name: normalizedUsername,
                    });
                } catch (authErr) {
                    setLocalError(t('profile.username_auth_error'));
                    console.error(authErr);
                    return;
                }
            }

            setUsernameInput(normalizedUsername);
            setAvatarInput(avatar_url || null);
            setBannerInput(banner_url || null);

            await refreshProfile(user.id);
            setMessage(t('profile.updated'));
            setShowModal(false);

            // If username changed, navigate to the new profile URL
            if (normalizedUsername !== ownProfile?.username) {
                // Limpiar cache de posts y resetear estado para forzar refetch
                clearFeedCache(`profile_posts_${user.id}`);
                setProfilePosts([]);
                setPostsLoading(true);
                navigate(`/profile/${normalizedUsername}`, { replace: true });
            }
        } catch (err) {
            setLocalError(err.message || t('profile.error_generic'));
        }
    };

    // ── Render ──
    if (!isAuthenticated && !profileUsername) {
        return <p>{t('profile.title')}</p>;
    }

    if (profileError) {
        return (
            <div className="profile-page">
                <div className="profile-card" style={{ padding: "40px", textAlign: "center" }}>
                    <p style={{ color: "#fca5a5", fontSize: "1.1rem" }}>{profileError}</p>
                </div>
            </div>
        );
    }

    if (!isOwnProfile && viewedProfileLoading) {
        return (
            <div className="profile-page">
                <div className="profile-card profile-skeleton-card">
                    <div className="profile-banner-container">
                        <div className="skeleton profile-skeleton-banner" />
                        <div className="skeleton skeleton--circle profile-skeleton-avatar" />
                        <div className="profile-skeleton-info">
                            <div className="skeleton profile-skeleton-username" />
                            <div className="profile-skeleton-stats">
                                <div className="skeleton profile-skeleton-stat" />
                                <div className="skeleton profile-skeleton-stat" />
                            </div>
                            <div className="skeleton profile-skeleton-bio" />
                            <div className="skeleton profile-skeleton-btn" />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!activeProfile) return null;

    const styleVars = (showAccent && activeProfile?.accent_color)
      ? { '--accent-color': activeProfile.accent_color, '--accent-text-color': getContrastText(activeProfile.accent_color) }
      : {};

    return (            <div className="profile-page" style={styleVars}>
            <div className="profile-card">
                <div className="profile-banner-container">
                    {bannerUrl ? (
                        <img
                            className="profile-banner"
                            src={bannerUrl}
                            alt="Profile Banner"
                        />
                    ) : (
                        <div className="profile-banner profile-banner--placeholder">
                            {t('profile.no_banner')}
                        </div>
                    )}

                    <div className="profile-avatar-container">
                        <img
                            className="profile-avatar"
                            src={
                                avatarUrl ||
                                "https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg"
                            }
                            alt="User Avatar"
                        />
                    </div>

                    <div className="profile-user-info">
                        <p className="profile-username">
                            {profileDisplayName}
                            <Badge roles={roles} />
                        </p>

                        <div className="profile-stats">
                            {canViewContent ? (
                              <>
                                <button
                                  type="button"
                                  className="profile-stat profile-stat--clickable"
                                  onClick={() => openFollowersModal("followers")}
                                >
                                  {countsLoading || followCounts === null ? (
                                    <span className="profile-stat-skeleton" />
                                  ) : (
                                    <span className="profile-stat-value">{followCounts.followers}</span>
                                  )}
                                  <span className="profile-stat-label">{t('profile.followers')}</span>
                                </button>
                                <button
                                  type="button"
                                  className="profile-stat profile-stat--clickable"
                                  onClick={() => openFollowersModal("following")}
                                >
                                  {countsLoading || followCounts === null ? (
                                    <span className="profile-stat-skeleton" />
                                  ) : (
                                    <span className="profile-stat-value">{followCounts.following}</span>
                                  )}
                                  <span className="profile-stat-label">{t('profile.following')}</span>
                                </button>
                                {!isOwnProfile && isFollowedBy === true && (
                                  <span className="profile-follows-you-badge">{t('profile.follows_you')}</span>
                                )}
                              </>
                            ) : (
                              <span className="profile-stat profile-stat--private">
                                <FaLock className="profile-stat-lock" />
                                <span className="profile-stat-label">{t('profile.private_profile')}</span>
                              </span>
                            )}
                        </div>

                        {activeProfile?.bio ? (
                            <p className="profile-bio">{activeProfile.bio}</p>
                        ) : (
                            <p className="profile-bio profile-bio--empty">{t('profile.no_bio')}</p>
                        )}

                        {/* ── Social Links ── */}
                        {activeProfile?.social_links?.length > 0 && (
                            <div className="profile-social-links">
                                {activeProfile.social_links.map((link, i) => (
                                    <a
                                        key={i}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="profile-social-link"
                                        title={getPlatformName(link.platform)}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <span className="profile-social-icon">{React.createElement(getPlatformIcon(link.platform))}</span>
                                    </a>
                                ))}
                            </div>
                        )}

                        <div className="profile-actions">
                            {isOwnProfile ? (
                                <button
                                    type="button"
                                    className="profile-edit-button"
                                    onClick={() => {
                                        setModalUsername(usernameInput || ownProfile?.username || "");
                                        setModalAvatar(avatarInput || ownProfile?.avatar_url || "");
                                        setModalBanner(bannerInput || ownProfile?.banner_url || "");
                                        setModalBio(ownProfile?.bio || "");
                                        setModalSocialLinks(ownProfile?.social_links || []);
                                        setModalAccentColor(ownProfile?.accent_color || '');
                                        setModalInterests(ownProfile?.interests || []);
                                        setShowModal(true);
                                    }}
                                >
                                    {t('profile.edit')}
                                </button>
                            ) : (
                                <FollowButton
                                    targetUserId={activeProfile.id}
                                    isPrivate={isPrivate}
                                    onFollowChange={(action) => {
                                        handleFollowChange();
                                        if (action === 'follow') {
                                            setIsFollower(true);
                                            setCachedFollowStatus(user.id, activeProfile.id, true);
                                        } else if (action === 'unfollow') {
                                            setIsFollower(false);
                                            setCachedFollowStatus(user.id, activeProfile.id, false);
                                        }
                                    }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit modal (own profile only) */}
            {isOwnProfile && (
                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    onSave={handleSaveProfile}
                    initialUsername={modalUsername}
                    initialAvatar={modalAvatar}
                    initialBanner={modalBanner}
                    initialBio={modalBio}
                    initialSocialLinks={modalSocialLinks}
                    initialAccentColor={modalAccentColor}
                    initialInterests={modalInterests}
                    userRoles={roles}
                />
            )}

            {localError && <p className="profile-error">{localError}</p>}
            {message && <p className="profile-message">{message}</p>}

            {/* Followers/Following modal */}
            {followersModal.open && (
                <FollowersModal
                    userId={activeProfile.id}
                    type={followersModal.type}
                    onClose={closeFollowersModal}
                />
            )}

            {/* ── Posts Section ── */}
            {!canViewContent ? (
              <div className="posts-section posts-section--private">
                <div className="posts-empty">
                  <span className="posts-empty-icon"><FaLock /></span>
                  <p className="posts-empty-text">{t('profile.private_posts_hidden')}</p>
                  <p className="posts-empty-subtext">{t('profile.private_posts_hint')}</p>
                </div>
              </div>
            ) : (
            <div className="posts-section">
                <div className="posts-section-header">
                    <div className="posts-section-tabs">
                        <button
                            className={`posts-section-tab ${tab === 'posts' ? 'posts-section-tab--active' : ''}`}
                            onClick={() => setTab('posts')}
                        >
                            {t('profile.posts_tab')}
                        </button>
                        {isOwnProfile && (
                            <button
                                className={`posts-section-tab ${tab === 'saved' ? 'posts-section-tab--active' : ''}`}
                                onClick={() => setTab('saved')}
                            >
                                {t('profile.saved_tab')}
                            </button>
                        )}
                    </div>
                    {isOwnProfile && (
                        <button
                            className="posts-section-action"
                            onClick={() => {
                                setEditingPost(null);
                                setShowCreatePost(true);
                            }}
                        >
                            {t('profile.new_post')}
                        </button>
                    )}
                </div>

                {tab === 'posts' ? (
                    postsLoading ? (
                        <div className="posts-skeleton">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="posts-skeleton-card">
                                    <div className="skeleton posts-skeleton-avatar" />
                                    <div className="posts-skeleton-lines">
                                        <div className="posts-skeleton-line posts-skeleton-line--short" />
                                        <div className="posts-skeleton-line" />
                                        <div className="posts-skeleton-line posts-skeleton-line--medium" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : profilePosts.length === 0 ? (
                        <div className="posts-empty">
                            <span className="posts-empty-icon"><FaFeather /></span>
                            <p className="posts-empty-text">
                                {isOwnProfile
                                    ? t('profile.no_posts_own')
                                    : t('profile.no_posts_other')}
                            </p>
                        </div>
                    ) : (
                        profilePosts.map((post) => (
                            <PostCard
                                key={post.id}
                                post={post}
                                liked={likedPostIds.includes(post.id)}
                                reposted={repostedPostIds.includes(post.id)}
                                saved={savedPostIds.includes(post.id)}
                                onUpdate={handlePostUpdate}
                                onDelete={handlePostDelete}
                                onSaveToggle={handleSaveToggle}
                                onLikeToggle={handleLikeToggle}
                                onRepostToggle={handleRepostToggle}
                                repostInfo={post._repostInfo ? { ...post._repostInfo, repostedBy: activeProfile?.username } : null}
                            />
                        ))
                    )
                ) : (
                    savedPostsLoading ? (
                        <div className="posts-skeleton">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="posts-skeleton-card">
                                    <div className="skeleton posts-skeleton-avatar" />
                                    <div className="posts-skeleton-lines">
                                        <div className="posts-skeleton-line posts-skeleton-line--short" />
                                        <div className="posts-skeleton-line" />
                                        <div className="posts-skeleton-line posts-skeleton-line--medium" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : savedPosts.length === 0 ? (
                        <div className="posts-empty">
                            <span className="posts-empty-icon"><FaBookmark /></span>
                            <p className="posts-empty-text">
                                {t('profile.no_saved')}
                            </p>
                            <p className="posts-empty-subtext">
                                {t('profile.no_saved_sub')}
                            </p>
                        </div>
                    ) : isOwnProfile && savedPosts.map((post) => (
                            <PostCard
                                key={post.id}
                                post={post}
                                liked={savedLikedIds.includes(post.id)}
                                reposted={savedRepostedIds.includes(post.id)}
                                saved={true}
                                onUpdate={handlePostUpdate}
                                onDelete={handlePostDelete}
                                onSaveToggle={handleSaveToggle}
                                onLikeToggle={handleLikeToggle}
                                onRepostToggle={handleRepostToggle}
                            />
                        ))
                )}
            </div>
            )}

            {/* Create/Edit Post modal */}
            {isOwnProfile && (
                <CreatePostModal
                    isOpen={showCreatePost}
                    onClose={() => {
                        setShowCreatePost(false);
                        setEditingPost(null);
                    }}
                    onSuccess={handlePostCreated}
                    editPost={editingPost}
                    userId={user?.id}
                />
            )}
        </div>
    );
}

export default Profile;
