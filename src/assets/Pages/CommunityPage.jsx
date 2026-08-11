import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import useBgContrast from '../../hooks/useBgContrast';
import { supabase, dbPublic } from '../services/supabaseclient';
import { toast } from 'react-toastify';
import { FaUsers, FaLock, FaPlus, FaCheck, FaTimes, FaSpinner, FaCamera, FaLink, FaTrophy, FaTrash, FaShieldAlt, FaRegComments, FaEllipsisH, FaCog } from 'react-icons/fa';
import {
  getCommunity,
  getMyMembership,
  joinCommunity,
  leaveCommunity,
  getCommunityMembers,
  getJoinRequests,
  respondJoinRequest,
  getCommunityPosts,
  createCommunityPost,
  deleteCommunityPost,
  getCommunityRoles,
  createCommunityRole,
  deleteCommunityRole,
  setMemberRole,
  createInvite,
  getCommunityInvites,
  deleteInvite,
  getActiveMembersRanking,
  redeemInvite,
} from '../services/communityService';
import {
  getLikedPostIds,
  getRepostedPostIds,
  getSavedPostIds,
  getDislikedPostIds,
} from '../services/postService';
import { uploadWithLocalPreview } from '../services/cdnService';
import VirtualPostList from '../Resources/Components/VirtualPostList';
import Avatar from '../Resources/Components/Avatar';
import ConfirmModal from '../Resources/Components/ConfirmModal';
import '../Resources/Components/css/profileSidebar.css';
import './styles/communities.css';

const BUILTIN_MODERATOR_ROLES = ['owner', 'admin', 'moderator'];
const SORT_OPTIONS = ['recent', 'relevance', 'likes', 'comments', 'dislikes', 'reposts'];
const TIME_OPTIONS = ['all', 'today', 'week', 'month'];

export default function CommunityPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  const [community, setCommunity] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState(null); // null | { role, status }
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [roles, setRoles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [ranking, setRanking] = useState([]);

  // Feed
  const [posts, setPosts] = useState([]);
  const [likedIds, setLikedIds] = useState([]);
  const [repostedIds, setRepostedIds] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [dislikedIds, setDislikedIds] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [sort, setSort] = useState('recent');
  const [timeRange, setTimeRange] = useState('all');

  // Composer
  const [composerText, setComposerText] = useState('');
  const [composerImage, setComposerImage] = useState('');
  const [composerUploading, setComposerUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState(null);

  // UI
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerMenuPos, setHeaderMenuPos] = useState(null); // { top, right } fixed
  const headerMenuRef = useRef(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#6366f1');
  const [newRolePerms, setNewRolePerms] = useState([]);
  const [showInvites, setShowInvites] = useState(false);
  const [deletingPost, setDeletingPost] = useState(null);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || null);
  const [inviteRedeeming, setInviteRedeeming] = useState(false);

  const membershipRef = useRef(null);
  useEffect(() => { membershipRef.current = membership; }, [membership]);

  // ── Cerrar menú de 3 puntos al hacer clic fuera o scrollear ──
  useEffect(() => {
    if (!headerMenuOpen) return;
    const handleClick = (e) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setHeaderMenuOpen(false);
      }
    };
    const closeOnScroll = () => setHeaderMenuOpen(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', closeOnScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', closeOnScroll, { capture: true });
    };
  }, [headerMenuOpen]);

  const bannerUrl = community?.banner_url || '';
  const contrastColor = useBgContrast(bannerUrl);
  const isMember = membership?.status === 'active';
  const isModerator = isMember && (
    BUILTIN_MODERATOR_ROLES.includes(membership?.role)
    || (membership?.role && roles.some((r) => r.name === membership.role && r.permissions.includes('manage_posts')))
  );
  const isOwner = membership?.role === 'owner';

  usePageTitle(community ? `c/${community.slug} · ${community.name}` : 'Community');

  // ── Carga inicial ──
  const loadCommunity = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const c = await getCommunity(slug);
      if (!c) {
        setNotFound(true);
        return;
      }
      setCommunity(c);
      let m = null;
      if (user?.id) {
        m = await getMyMembership(c.id, user.id);
        setMembership(m);
      }
      const [membersRes, rolesRes, rankingRes] = await Promise.all([
        getCommunityMembers(c.id).catch(() => []),
        getCommunityRoles(c.id).catch(() => []),
        getActiveMembersRanking(c.id).catch(() => []),
      ]);
      setMembers(membersRes);
      setRoles(rolesRes);
      setRanking(rankingRes);
      if (user?.id && m?.status === 'active') {
        getJoinRequests(c.id).then(setRequests).catch(() => setRequests([]));
        getCommunityInvites(c.id).then(setInvites).catch(() => setInvites([]));
      }
    } catch (err) {
      console.error('[Community] Error loading:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user?.id]);

  useEffect(() => { loadCommunity(); }, [loadCommunity]);

  // ── Feed ──
  const loadFeed = useCallback(async (cId, whichSort, whichTime) => {
    if (!cId) return;
    setFeedLoading(true);
    try {
      const data = await getCommunityPosts(cId, { sort: whichSort, timeRange: whichTime, limit: 50 });
      setPosts(data);
      if (user?.id && data.length > 0) {
        const ids = data.map((p) => p.id);
        const [l, r, s, d] = await Promise.all([
          getLikedPostIds(ids, user.id),
          getRepostedPostIds(ids, user.id),
          getSavedPostIds(ids, user.id),
          getDislikedPostIds(ids, user.id),
        ]);
        setLikedIds(l); setRepostedIds(r); setSavedIds(s); setDislikedIds(d);
      }
    } catch (err) {
      console.error('[Community] Error loading feed:', err);
    } finally {
      setFeedLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (community?.id) loadFeed(community.id, sort, timeRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.id, sort, timeRange]);

  // ── Realtime: contadores de posts + nuevos posts ──
  useEffect(() => {
    if (!community?.id) return;
    const channel = supabase
      .channel(`community-${community.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, (payload) => {
        const u = payload.new;
        setPosts((prev) => prev.map((p) =>
          p.id === u.id
            ? { ...p, likes_count: u.likes_count, dislikes_count: u.dislikes_count, reposts_count: u.reposts_count, comments_count: u.comments_count, views_count: u.views_count }
            : p
        ));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
        const np = payload.new;
        if (np.community_id !== community.id) return;
        if (np.user_id === user?.id) return;
        if (np.scheduled_at && new Date(np.scheduled_at) > new Date()) return;
        if (np.is_encrypted) return;
        if (community.is_private && membershipRef.current?.status !== 'active') return;
        try {
          const { data } = await dbPublic
            .from('posts')
            .select('*, profiles!posts_user_id_fkey (id, username, displayname, avatar_url, roles, is_private, avatar_position)')
            .eq('id', np.id)
            .single();
          if (!data) return;
          const { getCdnUrl } = await import('../services/cdnService');
          if (data.image_url) data.image_url = getCdnUrl(data.image_url);
          if (Array.isArray(data.image_urls)) data.image_urls = data.image_urls.map((u) => getCdnUrl(u));
          if (data.profiles?.avatar_url) data.profiles.avatar_url = getCdnUrl(data.profiles.avatar_url);
          setPosts((prev) => (prev.some((p) => p.id === data.id) ? prev : [data, ...prev]));
        } catch { /* silencioso */ }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        const oldId = payload.old?.id;
        if (oldId) setPosts((prev) => prev.filter((p) => p.id !== oldId));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_members' }, async (payload) => {
        if (payload.new.community_id !== community.id) return;
        // El contador lo mantiene el trigger en DB; aquí solo sincronizamos la UI
        if (payload.new.status === 'active') {
          setCommunity((prev) => (prev ? { ...prev, member_count: (prev.member_count || 0) + 1 } : prev));
        }
        if (payload.new.status === 'pending') {
          // Refrescar solicitudes (no-moderadores recibirán [] por RLS, sin romper)
          getJoinRequests(community.id).then(setRequests).catch(() => {});
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'community_members' }, (payload) => {
        if (payload.new.community_id !== community.id) return;
        const from = payload.old?.status;
        const to = payload.new.status;
        if (from === to) return;
        const delta = (to === 'active' ? 1 : 0) - (from === 'active' ? 1 : 0);
        if (delta !== 0) {
          setCommunity((prev) => (prev ? { ...prev, member_count: Math.max((prev.member_count || 0) + delta, 0) } : prev));
        }
        if (to === 'pending') {
          getJoinRequests(community.id).then(setRequests).catch(() => {});
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'community_members' }, (payload) => {
        if (payload.old?.community_id !== community.id) return;
        if (payload.old?.status === 'active') {
          setCommunity((prev) => (prev ? { ...prev, member_count: Math.max((prev.member_count || 0) - 1, 0) } : prev));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.id, user?.id]);

  // ── Acciones de membresía ──
  const handleJoin = async () => {
    if (!user?.id) { navigate('/Login'); return; }
    try {
      const res = await joinCommunity(community.id, user.id);
      setMembership({ role: res.role, status: res.status });
      // member_count se sincroniza vía realtime (INSERT/UPDATE de community_members)
      if (!res.isPending) {
        getCommunityMembers(community.id).then(setMembers).catch(() => {});
      }
      toast.success(res.isPending ? t('comunidades.request_sent') : t('comunidades.joined'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  // ── Canje de invitación (?invite=token) ──
  const handleRedeemInvite = async () => {
    if (!inviteToken) return;
    if (!user?.id) { navigate('/Login'); return; }
    setInviteRedeeming(true);
    try {
      const res = await redeemInvite(inviteToken, user.id);
      setInviteToken(null);
      setMembership({ role: res.role || 'member', status: res.status || 'active' });
      // member_count se sincroniza vía realtime
      getCommunityMembers(community.id).then(setMembers).catch(() => {});
      toast.success(t('comunidades.joined'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.invite_invalid'));
    } finally {
      setInviteRedeeming(false);
    }
  };

  const handleLeave = async () => {
    // El dueño no puede irse y dejar la comunidad sin líder
    if (membership?.role === 'owner') {
      toast.error(t('comunidades.owner_cannot_leave'));
      return;
    }
    try {
      await leaveCommunity(community.id, user.id);
      setMembership(null);
      // member_count se sincroniza vía realtime (DELETE de community_members)
      setMembers((prev) => prev.filter((m) => m.user_id !== user?.id));
      setPosts([]);
      toast.success(t('comunidades.left'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  // ── Moderación de solicitudes ──
  const handleRequest = async (userId, approve) => {
    try {
      await respondJoinRequest(community.id, userId, { approve });
      setRequests((prev) => prev.filter((r) => r.user_id !== userId));
      if (approve) {
        // member_count se sincroniza vía realtime (UPDATE pending → active)
        getCommunityMembers(community.id).then(setMembers).catch(() => {});
      }
      toast.success(approve ? t('comunidades.request_approved') : t('comunidades.request_rejected'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  // ── Roles ──
  const handleCreateRole = async () => {
    const roleName = newRoleName.trim();
    if (!roleName) return;
    try {
      await createCommunityRole(community.id, { name: roleName, color: newRoleColor, permissions: newRolePerms });
      setRoles(await getCommunityRoles(community.id));
      setShowCreateRole(false);
      setNewRoleName('');
      setNewRolePerms([]);
      toast.success(t('comunidades.role_created'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  const handleDeleteRole = async (role) => {
    try {
      await deleteCommunityRole(community.id, role.id, role.name);
      setRoles(await getCommunityRoles(community.id));
      toast.success(t('comunidades.role_deleted'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  const handleSetRole = async (targetUserId, role) => {
    try {
      await setMemberRole(community.id, targetUserId, role);
      setMembers((prev) => prev.map((m) => (m.user_id === targetUserId ? { ...m, role } : m)));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  // ── Invitaciones ──
  const handleCreateInvite = async () => {
    try {
      await createInvite(community.id, user.id);
      setInvites(await getCommunityInvites(community.id));
      toast.success(t('comunidades.invite_created'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  const handleDeleteInvite = async (inviteId) => {
    try {
      await deleteInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    }
  };

  const inviteUrl = (invite) => `${window.location.origin}/c/${community.slug}?invite=${invite.token}`;

  const copyInvite = async (invite) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(invite));
      toast.success(t('comunidades.invite_copied'));
    } catch {
      toast.error(t('comunidades.error'));
    }
  };

  // ── Composer ──
  const handleComposerImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('modal.invalid_image_type'));
      return;
    }
    setComposerUploading(true);
    try {
      const { localUrl, realUrlPromise } = uploadWithLocalPreview(file, user.id, 'post');
      setComposerImage(localUrl);
      const realUrl = await realUrlPromise;
      setComposerImage(realUrl);
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    } finally {
      setComposerUploading(false);
      e.target.value = '';
    }
  };

  const handlePost = async () => {
    const text = composerText.trim();
    if (!text && !composerImage) {
      setComposerError(t('create_post.empty_error'));
      return;
    }
    setPosting(true);
    setComposerError(null);
    try {
      const post = await createCommunityPost({
        userId: user.id,
        communityId: community.id,
        content: text || undefined,
        imageUrls: composerImage ? [composerImage] : undefined,
      });
      // Insertar al inicio del feed
      const { data } = await dbPublic
        .from('posts')
        .select('*, profiles!posts_user_id_fkey (id, username, displayname, avatar_url, roles, is_private, avatar_position)')
        .eq('id', post.id)
        .single();
      if (data) {
        const { getCdnUrl } = await import('../services/cdnService');
        if (data.image_url) data.image_url = getCdnUrl(data.image_url);
        if (Array.isArray(data.image_urls)) data.image_urls = data.image_urls.map((u) => getCdnUrl(u));
        if (data.profiles?.avatar_url) data.profiles.avatar_url = getCdnUrl(data.profiles.avatar_url);
        setPosts((prev) => [data, ...prev]);
      }
      setComposerText('');
      setComposerImage('');
      setCommunity((prev) => (prev ? { ...prev, post_count: (prev.post_count || 0) + 1 } : prev));
      toast.success(t('create_post.posted'));
    } catch (err) {
      console.error(err);
      setComposerError(err.message || t('comunidades.error'));
    } finally {
      setPosting(false);
    }
  };

  // ── Borrado de posts (owner/moderadores) — PostCard llama onDelete(postId) ──
  const handleDeletePost = useCallback((postId) => {
    setDeletingPost(postId);
  }, []);

  const confirmDeletePost = async () => {
    if (!deletingPost) return;
    try {
      await deleteCommunityPost(deletingPost);
      setPosts((prev) => prev.filter((p) => p.id !== deletingPost));
      setCommunity((prev) => (prev ? { ...prev, post_count: Math.max((prev.post_count || 0) - 1, 0) } : prev));
      toast.success(t('comunidades.post_deleted'));
    } catch (err) {
      console.error(err);
      toast.error(err.message || t('comunidades.error'));
    } finally {
      setDeletingPost(null);
    }
  };

  const handlePostUpdate = useCallback((updatedPost) => {
    setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? { ...p, ...updatedPost } : p)));
  }, []);

  // ── Render ──
  if (loading) {
    return (
      <div className="community-page-loading">
        <FaSpinner className="fc-spin" />
      </div>
    );
  }

  if (notFound || !community) {
    return (
      <div className="community-page community-page--empty">
        <div className="community-page-empty-icon"><FaUsers /></div>
        <h2 className="community-page-empty-title">{t('comunidades.not_found')}</h2>
        <p className="community-page-empty-sub">{t('comunidades.not_found_sub')}</p>
        <Link to="/Communities" className="community-page-empty-btn">{t('comunidades.back')}</Link>
      </div>
    );
  }

  const isPending = membership?.status === 'pending';
  const canPost = isMember;
  const canManage = isModerator;

  return (
    <div className="community-page">
      {/* ── Header ── */}
      <div
        className="community-header"
        style={{
          '--cc-accent': community.accent_color || 'transparent',
          '--cc-accent-2': community.accent_color_secondary || community.accent_color || 'transparent',
        }}
      >
        <div className="community-header-banner">
          {community.banner_url ? (
            <img src={community.banner_url} alt="" />
          ) : (
            <div className="community-header-banner-empty" />
          )}
          <div className="community-header-overlay" />
        </div>

        <div className="community-header-main">
          <div className="community-header-avatar-row">
            <div className="community-header-avatar">
              {community.avatar_url ? (
                <Avatar src={community.avatar_url} alt={community.name} />
              ) : (
                <span style={{ fontSize: '2.2rem', fontWeight: 800 }}>{community.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="community-header-actions">
              {!user?.id ? (
                <button className="community-header-btn community-header-btn--join" onClick={() => navigate('/Login')}>
                  {t('comunidades.join')}
                </button>
              ) : isPending ? (
                <span className="community-header-btn community-header-btn--pending">
                  <FaClockIcon /> {t('comunidades.pending')}
                </span>
              ) : isMember ? (
                <>
                  <span className="community-header-role-badge">{t(`comunidades.role_${membership.role}`)}</span>
                  {isOwner && (
                    <div className="community-header-menu-wrap" ref={headerMenuRef}>
                      <button
                        className={`community-header-btn community-header-btn--dots ${headerMenuOpen ? 'community-header-btn--dots-active' : ''}`}
                        onClick={(e) => {
                          // Posición fija para que el menú no quede recortado por
                          // el overflow:hidden del header (mismo patrón que Chat.jsx)
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHeaderMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                          setHeaderMenuOpen((s) => !s);
                        }}
                        title={t('comunidades.more')}
                      >
                        <FaEllipsisH />
                      </button>
                      {headerMenuOpen && headerMenuPos && (
                        <div className="community-header-dropdown" style={{ top: headerMenuPos.top, right: headerMenuPos.right }}>
                          <button
                            type="button"
                            className="community-header-dropdown-btn"
                            onClick={() => { setHeaderMenuOpen(false); setShowSettings(true); }}
                          >
                            <FaCog />
                            <span>{t('comunidades.settings')}</span>
                          </button>
                          <button
                            type="button"
                            className="community-header-dropdown-btn"
                            onClick={() => { setHeaderMenuOpen(false); setShowInvites(true); }}
                          >
                            <FaLink />
                            <span>{t('comunidades.invites')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {!isOwner && (
                    <button
                      className="community-header-btn community-header-btn--leave"
                      onClick={() => setLeavePending(true)}
                    >
                      {t('comunidades.leave')}
                    </button>
                  )}
                </>
              ) : (
                <button className="community-header-btn community-header-btn--join" onClick={handleJoin}>
                  {community.is_private && <FaLock />} {t('comunidades.join')}
                </button>
              )}
            </div>
          </div>

          <h1 className="community-header-name" style={{ color: contrastColor }}>
            {community.name}
          </h1>
          <span className="community-header-slug" style={{ color: contrastColor }}>
            c/{community.slug}
            {community.is_private && <span className="community-header-private"><FaLock /> {t('comunidades.private')}</span>}
            {community.is_mature && <span className="community-header-mature" title={t('comunidades.mature')}>+18</span>}
          </span>

          <div className="community-header-stats" style={{ color: contrastColor }}>
            <button type="button" className="community-header-stat" onClick={() => setShowMembersModal(true)}>
              <strong>{community.member_count || 0}</strong> {t('comunidades.members')}
            </button>
            <span className="community-header-stat">
              <strong>{community.post_count || 0}</strong> {t('comunidades.posts')}
            </span>
          </div>

          {community.description && (
            <p className="community-header-desc" style={{ color: contrastColor }}>{community.description}</p>
          )}

          {community.interests?.length > 0 && (
            <div className="community-header-interests">
              {community.interests.slice(0, 8).map((i) => (
                <span key={i} className="community-header-interest">{i}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="community-body">
        {/* ── Columna principal ── */}
        <div className="community-main">
          {/* ── Solicitudes pendientes (moderadores) ── */}
          {canManage && requests.length > 0 && (
            <div className="community-requests">
              <div className="community-section-title">
                <FaClockIcon /> {t('comunidades.join_requests')} ({requests.length})
              </div>
              <div className="community-requests-list">
                {requests.map((r) => (
                  <div key={r.user_id} className="community-request-item">
                    <Link to={`/profile/${r.profiles?.username}`} className="community-request-user">
                      <Avatar className="community-request-avatar" src={r.profiles?.avatar_url} alt={r.profiles?.username} />
                      <span className="community-request-name">@{r.profiles?.username || r.user_id.slice(0, 8)}</span>
                    </Link>
                    <div className="community-request-actions">
                      <button type="button" className="community-request-btn community-request-btn--ok" onClick={() => handleRequest(r.user_id, true)}>
                        <FaCheck />
                      </button>
                      <button type="button" className="community-request-btn community-request-btn--no" onClick={() => handleRequest(r.user_id, false)}>
                        <FaTimes />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Composer (miembros) ── */}
          {canPost && (
            <div className="community-composer">
              <textarea
                className="community-composer-textarea"
                value={composerText}
                onChange={(e) => { setComposerText(e.target.value); setComposerError(null); }}
                placeholder={t('comunidades.post_placeholder')}
                rows={3}
                maxLength={2000}
              />
              {composerError && <p className="community-composer-error">{composerError}</p>}
              <div className="community-composer-footer">
                <label className="community-composer-img-btn">
                  {composerUploading ? <FaSpinner className="fc-spin" /> : <FaCamera />}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleComposerImage}
                  />
                </label>
                {composerImage && (
                  <div className="community-composer-img-preview">
                    <img src={composerImage} alt="" />
                    <button type="button" onClick={() => setComposerImage('')}><FaTimes /></button>
                  </div>
                )}
                <button
                  className="community-composer-post"
                  onClick={handlePost}
                  disabled={posting || (!composerText.trim() && !composerImage)}
                >
                  {posting ? <FaSpinner className="fc-spin" /> : t('comunidades.post')}
                </button>
              </div>
            </div>
          )}

          {!user?.id && (
            <div className="community-join-prompt">
              <p>{t('comunidades.join_prompt')}</p>
              <button className="community-join-prompt-btn" onClick={() => navigate('/Login')}>{t('auth.login_btn')}</button>
            </div>
          )}

          {isPending && (
            <div className="community-join-prompt">
              <FaLock />
              <p>{t('comunidades.pending_hint')}</p>
            </div>
          )}

          {inviteToken && !isMember && !isPending && (
            <div className="community-join-prompt">
              <FaLink />
              <p>{t('comunidades.invite_prompt')}</p>
              <button
                className="community-join-prompt-btn"
                onClick={handleRedeemInvite}
                disabled={inviteRedeeming}
              >
                {inviteRedeeming ? <FaSpinner className="fc-spin" /> : t('comunidades.join')}
              </button>
            </div>
          )}

          {community.is_private && !isMember && !isPending && !inviteToken && (
            <div className="community-join-prompt">
              <FaLock />
              <p>{t('comunidades.private_hint')}</p>
            </div>
          )}

          {/* ── Feed controls ── */}
          <div className="community-feed-controls">
            <div className="community-feed-sorts">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`community-feed-sort ${sort === opt ? 'community-feed-sort--active' : ''}`}
                  onClick={() => setSort(opt)}
                >
                  {t(`comunidades.sort_${opt}`)}
                </button>
              ))}
            </div>
            <div className="community-feed-times">
              {TIME_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`community-feed-time ${timeRange === opt ? 'community-feed-time--active' : ''}`}
                  onClick={() => setTimeRange(opt)}
                >
                  {t(`comunidades.time_${opt}`)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Feed ── */}
          {feedLoading ? (
            <div className="community-feed-skeleton">
              {[1, 2, 3].map((i) => (
                <div key={i} className="posts-skeleton-card">
                  <div className="skeleton posts-skeleton-avatar" />
                  <div className="posts-skeleton-lines">
                    <div className="skeleton posts-skeleton-line posts-skeleton-line--short" />
                    <div className="skeleton posts-skeleton-line" />
                  </div>
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="community-feed-empty">
              <FaRegComments />
              <p>{t('comunidades.no_posts')}</p>
            </div>
          ) : (
            <VirtualPostList
              posts={posts}
              likedIds={likedIds}
              dislikedIds={dislikedIds}
              repostedIds={repostedIds}
              savedIds={savedIds}
              onUpdate={handlePostUpdate}
              onDelete={isModerator ? handleDeletePost : undefined}
              onLikeToggle={(id, v) => setLikedIds((p) => (v ? [...p, id] : p.filter((x) => x !== id)))}
              onDislikeToggle={(id, v) => setDislikedIds((p) => (v ? [...p, id] : p.filter((x) => x !== id)))}
              onRepostToggle={(id, v) => setRepostedIds((p) => (v ? [...p, id] : p.filter((x) => x !== id)))}
              onSaveToggle={(id, v) => setSavedIds((p) => (v ? [...p, id] : p.filter((x) => x !== id)))}
            />
          )}
        </div>

        {/* ── Sidebar (estilos del sidebar de perfil reutilizados) ── */}
        <div className="community-sidebar">
          {/* ── Ranking de activos ── */}
          {ranking.length > 0 && (
            <div className="profile-sidebar-card">
              <div className="profile-sidebar-title"><FaTrophy className="profile-sidebar-title-icon" /> {t('comunidades.most_active')}</div>
              <div className="community-ranking">
                {ranking.map((r, idx) => (
                  <Link
                    key={r.user_id}
                    to={`/profile/${r.profile?.username}`}
                    className="community-ranking-item"
                  >
                    <span className={`community-ranking-pos ${idx < 3 ? `community-ranking-pos--${idx + 1}` : ''}`}>{idx + 1}</span>
                    <Avatar className="community-ranking-avatar" src={r.profile?.avatar_url} alt={r.profile?.username} />
                    <span className="community-ranking-name">@{r.profile?.username || '…'}</span>
                    <span className="community-ranking-score">{r.score}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Reglas ── */}
          {community.rules?.length > 0 && (
            <div className="profile-sidebar-card">
              <div className="profile-sidebar-title"><FaShieldAlt className="profile-sidebar-title-icon" /> {t('comunidades.rules')}</div>
              <ol className="community-rules-list">
                {community.rules.map((rule, i) => (
                  <li key={i} className="community-rule-item">{rule}</li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Miembros ── */}
          {members.length > 0 && (
            <div className="profile-sidebar-card">
              <div className="profile-sidebar-title"><FaUsers className="profile-sidebar-title-icon" /> {t('comunidades.members')}</div>
              <div className="community-members-preview">
                {members.slice(0, 12).map((m) => (
                  <Link key={m.user_id} to={`/profile/${m.profiles?.username}`} title={`@${m.profiles?.username || ''}`}>
                    <Avatar className="community-members-preview-avatar" src={m.profiles?.avatar_url} alt={m.profiles?.username} />
                  </Link>
                ))}
                {members.length > 12 && (
                  <button type="button" className="community-members-more" onClick={() => setShowMembersModal(true)}>
                    +{members.length - 12}
                  </button>
                )}
              </div>
              <button type="button" className="community-sidebar-link" onClick={() => setShowMembersModal(true)}>
                {t('comunidades.view_all_members')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal de miembros ── */}
      {showMembersModal && (
        <div className="community-modal-backdrop" onClick={() => setShowMembersModal(false)}>
          <div className="community-modal" onClick={(e) => e.stopPropagation()}>
            <div className="community-modal-header">
              <span className="community-modal-title">{t('comunidades.members')} ({members.length})</span>
              <button type="button" className="community-modal-close" onClick={() => setShowMembersModal(false)}><FaTimes /></button>
            </div>
            <div className="community-modal-body">
              {members.map((m) => (
                <div key={m.user_id} className="community-member-row">
                  <Link to={`/profile/${m.profiles?.username}`} className="community-member-main">
                    <Avatar className="community-member-avatar" src={m.profiles?.avatar_url} alt={m.profiles?.username} />
                    <div>
                      <span className="community-member-name">@{m.profiles?.username || '…'}</span>
                      <span className="community-member-role">{t(`comunidades.role_${m.role}`)}</span>
                    </div>
                  </Link>
                  {(isOwner || isModerator) && m.user_id !== user?.id && (
                    <select
                      className="community-member-role-select"
                      value={m.role}
                      onChange={(e) => handleSetRole(m.user_id, e.target.value)}
                    >
                      <option value="member">{t('comunidades.role_member')}</option>
                      <option value="moderator">{t('comunidades.role_moderator')}</option>
                      <option value="admin">{t('comunidades.role_admin')}</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.name}>{r.name}</option>
                      ))}
                      <option value="owner" disabled>{t('comunidades.role_owner')}</option>
                    </select>
                  )}
                </div>
              ))}
              {members.length === 0 && <p className="community-modal-empty">{t('comunidades.no_members')}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de invitaciones ── */}
      {showInvites && (
        <div className="community-modal-backdrop" onClick={() => setShowInvites(false)}>
          <div className="community-modal" onClick={(e) => e.stopPropagation()}>
            <div className="community-modal-header">
              <span className="community-modal-title">{t('comunidades.invites')}</span>
              <button type="button" className="community-modal-close" onClick={() => setShowInvites(false)}><FaTimes /></button>
            </div>
            <div className="community-modal-body">
              <button type="button" className="community-invite-create" onClick={handleCreateInvite}>
                <FaPlus /> {t('comunidades.invite_create')}
              </button>
              {invites.map((inv) => (
                <div key={inv.id} className="community-invite-row">
                  <code className="community-invite-token">{inviteUrl(inv)}</code>
                  <button type="button" className="community-invite-copy" onClick={() => copyInvite(inv)}>
                    {t('comunidades.invite_copy')}
                  </button>
                  <button type="button" className="community-invite-del" onClick={() => handleDeleteInvite(inv.id)}>
                    <FaTrash />
                  </button>
                </div>
              ))}
              {invites.length === 0 && <p className="community-modal-empty">{t('comunidades.no_invites')}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de ajustes (owner): roles + accesos rápidos ── */}
      {showSettings && isOwner && (
        <div className="community-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="community-modal" onClick={(e) => e.stopPropagation()}>
            <div className="community-modal-header">
              <span className="community-modal-title">{t('comunidades.settings')}</span>
              <button type="button" className="community-modal-close" onClick={() => setShowSettings(false)}><FaTimes /></button>
            </div>
            <div className="community-modal-body">
              <div className="community-roles-bar-title"><FaShieldAlt /> {t('comunidades.roles')}</div>
              <div className="community-roles-bar-list">
                {roles.map((r) => (
                  <span key={r.id} className="community-role-chip" style={{ '--cc-role': r.color || '#6366f1' }}>
                    {r.name}
                    <button type="button" onClick={() => handleDeleteRole(r)}><FaTimes /></button>
                  </span>
                ))}
                <button type="button" className="community-roles-bar-add" onClick={() => setShowCreateRole(true)}>
                  <FaPlus /> {t('comunidades.role_create')}
                </button>
              </div>
              <button
                type="button"
                className="community-sidebar-link"
                style={{ marginTop: 14 }}
                onClick={() => { setShowSettings(false); setShowInvites(true); }}
              >
                <FaLink style={{ marginRight: 4 }} /> {t('comunidades.invites')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateRole && (
        <div className="community-modal-backdrop" onClick={() => setShowCreateRole(false)}>
          <div className="community-modal" onClick={(e) => e.stopPropagation()}>
            <div className="community-modal-header">
              <span className="community-modal-title">{t('comunidades.role_create')}</span>
              <button type="button" className="community-modal-close" onClick={() => setShowCreateRole(false)}><FaTimes /></button>
            </div>
            <div className="community-modal-body">
              <input
                className="fc-modal-input"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder={t('comunidades.role_name')}
                maxLength={30}
              />
              <div className="community-role-color-row">
                <span>{t('comunidades.role_color')}</span>
                <input type="color" value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} />
              </div>
              <div className="community-role-perms">
                {['manage_posts', 'manage_members', 'manage_requests', 'manage_chat', 'manage_roles'].map((perm) => (
                  <label key={perm} className="community-role-perm">
                    <input
                      type="checkbox"
                      checked={newRolePerms.includes(perm)}
                      onChange={(e) => setNewRolePerms((prev) =>
                        e.target.checked ? [...prev, perm] : prev.filter((x) => x !== perm)
                      )}
                    />
                    {t(`comunidades.perm_${perm}`)}
                  </label>
                ))}
              </div>
              <button type="button" className="community-role-save" onClick={handleCreateRole} disabled={!newRoleName.trim()}>
                {t('comunidades.role_save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmar salida ── */}
      {leavePending && (
        <ConfirmModal
          message={t('comunidades.leave_confirm')}
          onConfirm={() => { setLeavePending(false); handleLeave(); }}
          onCancel={() => setLeavePending(false)}
        />
      )}

      {/* ── Confirmar borrado de post ── */}
      {deletingPost && (
        <ConfirmModal
          message={t('comunidades.delete_post_confirm')}
          onConfirm={confirmDeletePost}
          onCancel={() => setDeletingPost(null)}
        />
      )}
    </div>
  );
}

// Icono de reloj reutilizado (evita importar otra librería)
function FaClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
