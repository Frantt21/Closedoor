import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { FaRegNewspaper } from 'react-icons/fa';
import { useI18n } from '../services/i18n/useI18n';
import '../Resources/Styles/Home.css';
import '../Resources/Styles/post.css';
import { useAuth } from '../../hooks/useAuth';
import usePageTitle from '../../hooks/usePageTitle';
import { supabase } from '../services/supabaseclient';
import { getBlockedUsers, getUsersWhoBlockedMe, subscribeBlockChanges } from '../services/blockService';
import {
  getFeed,
  getLikedPostIds,
  getRepostedPostIds,
  getSavedPostIds,
  setCachedFeed,
  getCachedFeed,
} from '../services/postService';
import PostCard from '../Resources/Components/PostCard';
import CreatePostModal from '../Resources/Components/CreatePostModal';

function Home() {
    const { t } = useI18n();
    usePageTitle(t('home.title'));
    const { user, isAuthenticated } = useAuth();

    const [posts, setPosts] = useState(() => {
        const cached = getCachedFeed('home_feed');
        return cached?.items || [];
    });
    const [likedPostIds, setLikedPostIds] = useState(() => {
        const cached = getCachedFeed('home_feed');
        return cached?.likedIds || [];
    });
    const [repostedPostIds, setRepostedPostIds] = useState(() => {
        const cached = getCachedFeed('home_feed');
        return cached?.repostedIds || [];
    });
    const [savedPostIds, setSavedPostIds] = useState(() => {
        const cached = getCachedFeed('home_feed');
        return cached?.savedIds || [];
    });
    const [postsLoading, setPostsLoading] = useState(() => {
        return !getCachedFeed('home_feed');
    });
    const [showCreatePost, setShowCreatePost] = useState(false);
    const [editingPost, setEditingPost] = useState(null);

    // ── Load feed (con cache) ──
    useEffect(() => {
        const cached = getCachedFeed('home_feed');
        if (cached) {
            setPosts(cached.items || []);
            setLikedPostIds(cached.likedIds || []);
            setRepostedPostIds(cached.repostedIds || []);
            setSavedPostIds(cached.savedIds || []);
            setPostsLoading(false);
        }

        const loadFeed = async () => {
            try {
                let data = await getFeed({ limit: 30, userId: user?.id });
                // Filtrar posts de usuarios bloqueados (ambas direcciones)
                if (user?.id && data.length > 0) {
                    try {
                        const [blocked, blockedMe] = await Promise.all([
                            getBlockedUsers(user.id),
                            getUsersWhoBlockedMe(user.id),
                        ]);
                        const excludedIds = new Set([
                            ...blocked.map(b => b.id),
                            ...blockedMe.map(b => b.id),
                        ]);
                        data = data.filter(p => !excludedIds.has(p.user_id));
                    } catch (e) {
                        console.warn('Could not filter blocked posts:', e);
                    }
                }
                setPosts(data);
                let likedIds = [], repostedIds = [], savedIds = [];
                if (user?.id && data.length > 0) {
                    const postIds = data.map((p) => p.id);
                    [likedIds, repostedIds, savedIds] = await Promise.all([
                        getLikedPostIds(postIds, user.id),
                        getRepostedPostIds(postIds, user.id),
                        getSavedPostIds(postIds, user.id),
                    ]);
                    setLikedPostIds(likedIds);
                    setRepostedPostIds(repostedIds);
                    setSavedPostIds(savedIds);
                }
                setCachedFeed('home_feed', data, likedIds, repostedIds, savedIds);
            } catch (err) {
                console.error('Error loading feed:', err);
            } finally {
                setPostsLoading(false);
            }
        };

        loadFeed();
    }, [user?.id]);

    // ── Realtime: actualizar contadores de likes/reposts/comments en vivo ──
    useEffect(() => {
        const channel = supabase
            .channel('home-feed-updates')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'posts' },
                (payload) => {
                    const updated = payload.new;
                    setPosts((prev) =>
                        prev.map((p) =>
                            p.id === updated.id
                                ? { ...p, likes_count: updated.likes_count, reposts_count: updated.reposts_count, comments_count: updated.comments_count }
                                : p
                        )
                    );
                }
            )
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    // ── Re-filtrar posts cuando cambia el estado de bloqueo ──
    useEffect(() => {
      if (!user?.id) return;
      const unsub = subscribeBlockChanges(async () => {
        try {
          const [blocked, blockedMe] = await Promise.all([
            getBlockedUsers(user.id),
            getUsersWhoBlockedMe(user.id),
          ]);
          const excludedIds = new Set([
            ...blocked.map(b => b.id),
            ...blockedMe.map(b => b.id),
          ]);
          setPosts((prev) => prev.filter(p => !excludedIds.has(p.user_id)));
        } catch (e) {
          console.warn('Could not re-filter blocked posts:', e);
        }
      });
      return unsub;
    }, [user?.id]);

    const handlePostCreated = async () => {
        try {
            const data = await getFeed({ limit: 30, userId: user?.id });
            setPosts(data);
            let likedIds = [], repostedIds = [], savedIds = [];
            if (user?.id && data.length > 0) {
                const postIds = data.map((p) => p.id);
                [likedIds, repostedIds, savedIds] = await Promise.all([
                    getLikedPostIds(postIds, user.id),
                    getRepostedPostIds(postIds, user.id),
                    getSavedPostIds(postIds, user.id),
                ]);
                setLikedPostIds(likedIds);
                setRepostedPostIds(repostedIds);
                setSavedPostIds(savedIds);
            }
            setCachedFeed('home_feed', data, likedIds, repostedIds, savedIds);
        } catch (err) {
            console.error('Error refreshing feed:', err);
        }
    };

    const handlePostUpdate = (updatedPost) => {
        if (updatedPost._editing) {
            setEditingPost(updatedPost);
            setShowCreatePost(true);
            return;
        }
        setPosts((prev) =>
            prev.map((p) => (p.id === updatedPost.id ? { ...p, ...updatedPost } : p))
        );
    };

    const handlePostDelete = (postId) => {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
    };

    return (
        <div>
            {!isAuthenticated ? (
                <div className="home-hero">
                    <h1 className="home-hero-title">{t('home.hero_title')}</h1>
                    <p className="home-hero-subtitle">
                        {t('home.hero_subtitle')}
                    </p>
                    <p className="home-hero-subtitle">
                        {t('home.hero_subtitle2')}
                    </p>
                    <div className="home-hero-actions">
                        <Link to="/Register" className="home-hero-btn home-hero-btn--primary">
                            {t('auth.register_btn')}
                        </Link>
                        <Link to="/Login" className="home-hero-btn home-hero-btn--secondary">
                            {t('auth.login_btn')}
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="posts-section">
                    <div className="posts-section-header">
                            <button
                            className="posts-section-action"
                            onClick={() => setShowCreatePost(true)}
                        >
                            {t('home.new_post')}
                        </button>
                    </div>

                    {postsLoading ? (
                        <div className="posts-skeleton">
                            {[1, 2, 3, 4, 5].map((i) => (
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
                    ) : posts.length === 0 ? (
                        <div className="posts-empty">
                            <span className="posts-empty-icon"><FaRegNewspaper /></span>
                            <p className="posts-empty-text">
                                {t('home.no_posts_first')}
                            </p>
                        </div>
                    ) : (
                        posts.map((post) => (
                            <PostCard
                                key={post.id}
                                post={post}
                                liked={likedPostIds.includes(post.id)}
                                reposted={repostedPostIds.includes(post.id)}
                                saved={savedPostIds.includes(post.id)}
                                onUpdate={handlePostUpdate}
                                onDelete={handlePostDelete}
                            />
                        ))
                    )}
                </div>
            )}

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
        </div>
    );
}

export default Home;