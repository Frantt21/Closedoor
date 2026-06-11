import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import {
  likePost,
  unlikePost,
  deletePost,
  togglePinPost,
  repostPost,
  unrepostPost,
  savePost,
  unsavePost,
} from '../../services/postService';
import { FaHeart, FaRegHeart, FaComment, FaRetweet, FaThumbtack, FaEdit, FaTrash, FaEllipsisV, FaBookmark, FaRegBookmark } from 'react-icons/fa';
import Badge from './Badge';
import { useI18n } from '../../services/i18n/useI18n';
import './css/postCard.css';

const DEFAULT_AVATAR = 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';

export default function PostCard({
  post,
  liked: initialLiked = false,
  reposted: initialReposted = false,
  saved: initialSaved = false,
  onUpdate,
  onDelete,
  onSaveToggle,
  compact = false,
  repostInfo = null,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [liked, setLiked] = useState(initialLiked);
  const [likesCount, setLikesCount] = useState(post.likes_count || 0);
  const [reposted, setReposted] = useState(initialReposted);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count || 0);
  const [saved, setSaved] = useState(initialSaved);
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const menuRef = useRef(null);

  // Sincronizar estado liked/reposted cuando el padre refetchea (navegación)
  // Separado de los contadores para evitar race condition con Realtime:
  // cuando llega un UPDATE de likes_count desde Realtime, NO debe resetear liked a initialLiked
  useEffect(() => {
    setLiked(initialLiked);
  }, [initialLiked]);

  // Sincronizar contadores desde la DB (Realtime o refetch)
  useEffect(() => {
    setLikesCount(post.likes_count || 0);
  }, [post.likes_count]);

  useEffect(() => {
    setReposted(initialReposted);
  }, [initialReposted]);

  useEffect(() => {
    setRepostsCount(post.reposts_count || 0);
  }, [post.reposts_count]);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const isOwner = user?.id === post.user_id;
  const profile = post.profiles;
  const timeAgo = getTimeAgo(t, locale, post.created_at);

  const handleLike = async (e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      if (liked) {
        await unlikePost(post.id, user.id);
        setLiked(false);
        setLikesCount((c) => Math.max(c - 1, 0));
      } else {
        await likePost(post.id, user.id);
        setLiked(true);
        setLikesCount((c) => c + 1);
      }
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const handleRepost = async (e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      if (reposted) {
        await unrepostPost(post.id, user.id);
        setReposted(false);
        setRepostsCount((c) => Math.max(c - 1, 0));
      } else {
        await repostPost(post.id, user.id);
        setReposted(true);
        setRepostsCount((c) => c + 1);
      }
    } catch (err) {
      console.error('Repost error:', err);
    }
  };

  const handlePin = async (e) => {
    e.stopPropagation();
    if (!user) return;
    const nowPinned = !post.is_pinned;
    try {
      await togglePinPost(post.id, user.id, post.is_pinned);
      if (onUpdate) {
        onUpdate({
          ...post,
          is_pinned: nowPinned,
          pinned_at: nowPinned ? new Date().toISOString() : null,
        });
      }
    } catch (err) {
      console.error('Pin error:', err);
      if (err.message) alert(err.message);
    }
    setShowMenu(false);
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(t('post.delete_confirm'))) return;
    setDeleting(true);
    try {
      await deletePost(post.id);
      if (onDelete) onDelete(post.id);
    } catch (err) {
      console.error('Delete error:', err);
      setDeleting(false);
    }
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      if (saved) {
        await unsavePost(post.id, user.id);
        setSaved(false);
        if (onSaveToggle) onSaveToggle(post.id, false);
      } else {
        await savePost(post.id, user.id);
        setSaved(true);
        if (onSaveToggle) onSaveToggle(post.id, true);
      }
    } catch (err) {
      console.error('Save error:', err);
    }
  };

  // Cerrar lightbox con Escape
  useEffect(() => {
    if (!lightboxUrl) return;
    const handleKey = (e) => { if (e.key === 'Escape') setLightboxUrl(null); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [lightboxUrl]);

  const handleCardClick = () => {
    navigate(`/post/${post.id}`);
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    if (onUpdate) onUpdate({ ...post, _editing: true });
    setShowMenu(false);
  };

  const isVideo = (url) => {
    if (!url) return false;
    const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
    const lower = url.toLowerCase();
    return videoExts.some((ext) => lower.includes(ext)) || lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('vimeo.com');
  };

  const getEmbedUrl = (url) => {
    if (!url) return null;
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    return null;
  };

  const openLightbox = (e, url) => {
    e.stopPropagation();
    setLightboxUrl(url);
  };

  // Detectar media incrustado en el texto (para posts sin image_url/video_url separados)
  const detectInlineMedia = (text) => {
    if (post.image_url || post.video_url) return null;
    const urlPattern = /(https?:\/\/[^\s<]+)/gi;
    const urls = text?.match(urlPattern) || [];
    const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i;
    const VID_RE = /\.(mp4|webm|ogg)(\?.*)?$/i;
    for (const url of urls) {
      if (IMG_RE.test(url)) return { type: 'image', url };
      if (VID_RE.test(url)) return { type: 'video', url };
    }
    return null;
  };

  const inlineMedia = detectInlineMedia(post.content);

  return (
    <article
      className={`post-card ${deleting ? 'post-card--deleting' : ''} ${compact ? 'post-card--compact' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(); }}
    >
      {/* Repost banner */}
      {repostInfo && (
        <div className="post-card-repost-banner">
          <FaRetweet className="post-card-repost-icon" />
          <span>{t('post.reposted_by', { user: repostInfo.repostedBy })}</span>
        </div>
      )}

      {/* Pin badge */}
      {post.is_pinned && (
        <div className="post-card-pin">
          <FaThumbtack />
          <span>{t('post.pinned')}</span>
        </div>
      )}

      <div className="post-card-body">
        {/* Avatar */}
        <Link
          to={`/profile/${profile?.username}`}
          className="post-card-avatar-link"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            className="post-card-avatar"
            src={profile?.avatar_url || DEFAULT_AVATAR}
            alt={profile?.username || 'user'}
          />
        </Link>

        {/* Content */}
        <div className="post-card-content">
          {/* Header: username + time + menu */}
          <div className="post-card-header">
            <Link
              to={`/profile/${profile?.username}`}
              className="post-card-author"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="post-card-username">{profile?.username || 'unknown'}</span>
              {profile?.roles && <Badge roles={profile.roles} />}
              <span className="post-card-time">{timeAgo}</span>
            </Link>

            {isOwner && (
              <div className="post-card-menu-wrapper" ref={menuRef}>
                <button
                  className="post-card-menu-btn"
                  onClick={(e) => { e.stopPropagation(); setShowMenu((s) => !s); }}
                  aria-label="Post options"
                >
                  <FaEllipsisV />
                </button>
                {showMenu && (
                  <div className="post-card-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                    <button onClick={handleEdit}><FaEdit /> {t('post.edit')}</button>
                    <button onClick={handlePin}><FaThumbtack /> {post.is_pinned ? t('post.unpin') : t('post.pin')}</button>
                    <button className="post-card-menu-danger" onClick={handleDelete}><FaTrash /> {t('post.delete')}</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Text content with @mention highlighting */}
          <p className="post-card-text">{renderContent(post.content, getSkipUrls(post), post.mentions)}</p>

          {/* Multiple images from post.image_urls (grid) */}
          {renderImageGrid(post, openLightbox, t)}

          {/* Video from post.video_url */}
          {post.video_url && isVideo(post.video_url) && (
            <div className="post-card-media">
              {getEmbedUrl(post.video_url) ? (
                <iframe
                  src={getEmbedUrl(post.video_url)}
                  className="post-card-video"
                  title="Video"
                  allowFullScreen
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <video
                  src={post.video_url}
                  className="post-card-video"
                  controls
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          )}

          {/* Legacy: single image from post.image_url */}
          {post.image_url && !post.image_urls?.length && !post.video_url && (
            <div className="post-card-media">
              <img
                src={post.image_url}
                alt={t('post.media_alt', { n: 1 })}
                className="post-card-image"
                onClick={(e) => openLightbox(e, post.image_url)}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          )}

          {/* Legacy: image in post.video_url */}
          {post.video_url && !isVideo(post.video_url) && !post.image_url && (
            <div className="post-card-media">
              <img
                src={post.video_url}
                alt={t('post.media_alt', { n: 1 })}
                className="post-card-image"
                onClick={(e) => openLightbox(e, post.video_url)}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          )}

          {/* Legacy: inline media detection */}
          {inlineMedia && !post.image_url && !post.image_urls?.length && !post.video_url && (
            <div className="post-card-media">
              {inlineMedia.type === 'image' ? (
                <img
                  src={inlineMedia.url}
                  alt={t('post.media_alt', { n: 1 })}
                  className="post-card-image"
                  onClick={(e) => openLightbox(e, inlineMedia.url)}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                <video
                  src={inlineMedia.url}
                  className="post-card-video"
                  controls
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="post-card-actions">
            <button
              className={`post-card-action ${liked ? 'post-card-action--liked' : ''}`}
              onClick={handleLike}
            >
              <span className="post-card-action-icon">{liked ? <FaHeart /> : <FaRegHeart />}</span>
              <span className="post-card-action-count">{likesCount}</span>
            </button>

            <button
              className="post-card-action"
              onClick={(e) => { e.stopPropagation(); navigate(`/post/${post.id}`); }}
            >
              <span className="post-card-action-icon"><FaComment /></span>
              <span className="post-card-action-count">{post.comments_count || 0}</span>
            </button>

            <button
              className={`post-card-action ${reposted ? 'post-card-action--reposted' : ''}`}
              onClick={handleRepost}
            >
              <span className="post-card-action-icon"><FaRetweet /></span>
              <span className="post-card-action-count">{repostsCount}</span>
            </button>

            <button
              className={`post-card-action ${saved ? 'post-card-action--saved' : ''}`}
              onClick={handleSave}
              title={saved ? t('post.saved') : t('post.save')}
            >
              <span className="post-card-action-icon">{saved ? <FaBookmark /> : <FaRegBookmark />}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Lightbox ── */}
      {lightboxUrl && (
        <div className="post-card-lightbox" onClick={() => setLightboxUrl(null)}>
          <div className="post-card-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxUrl} alt={t('post.full_media')} />
            <div className="post-card-lightbox-actions">
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="post-card-lightbox-btn"
                title={t('post.open_new_tab')}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <a
                href={lightboxUrl}
                download
                className="post-card-lightbox-btn"
                title={t('post.download')}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </a>
              <button
                className="post-card-lightbox-btn post-card-lightbox-close"
                onClick={() => setLightboxUrl(null)}
                title={t('post.close')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Render @mentions as clickable links and URLs as clickable links ──
function renderContent(text, skipUrls = [], mentions = {}) {
  if (!text) return null;
  const skipSet = new Set(skipUrls);
  // Match both @mentions and URLs
  const combinedRegex = /(?<![\w@])(@[a-zA-Z0-9_]+)|(https?:\/\/[^\s<]+)/gi;
  const parts = [];
  let lastIndex = 0, match;
  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const matchedText = match[0];
    // Saltar URLs que son media (imagen/video) — se renderizan aparte como preview
    if (matchedText.startsWith('@') || !skipSet.has(matchedText)) {
      parts.push(matchedText);
    }
    lastIndex = match.index + matchedText.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const username = part.slice(1);
      // Find user_id from mentions mapping by matching stored username
      const mentionEntry = Object.entries(mentions).find(([, stored]) => stored === username);
      const profileLink = mentionEntry ? `/profile/${mentionEntry[0]}` : `/profile/${username}`;
      return (
        <Link
          key={i}
          to={profileLink}
          className="post-card-mention"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>
      );
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="post-card-link"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

// Genera URLs a ocultar del texto porque ya se renderizan como media aparte
function getSkipUrls(post) {
  const text = post?.content;
  if (!text) return [];
  const urlPattern = /(https?:\/\/[^\s<]+)/gi;
  const urls = text.match(urlPattern) || [];
  const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i;
  const VID_RE = /\.(mp4|webm|ogg)(\?.*)?$/i;
  const result = [];
  for (const url of urls) {
    if (IMG_RE.test(url) || VID_RE.test(url) || (post.video_url && url === post.video_url)) {
      result.push(url);
    }
  }
  return result;
}

// ── Render image grid (up to 4 images) ──
function renderImageGrid(post, onImageClick, t) {
  const urls = (post.image_urls || (post.image_url ? [post.image_url] : []))
    .filter((url) => {
      // Excluir URLs de video — se renderizan aparte (seguridad ante datos duplicados)
      if (!url) return false;
      const VID_RE = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i;
      return !VID_RE.test(url);
    });
  if (!urls.length) return null;

  const handleClick = onImageClick || ((e) => e.stopPropagation());

  const gridClass = `post-card-image-grid post-card-image-grid--${Math.min(urls.length, 4)}`;

  return (
    <div className={gridClass}>
      {urls.slice(0, 4).map((url, i) => (
        <div key={i} className="post-card-image-grid-item">
          <img
            src={url}
            alt={t('post.media_alt', { n: i + 1 })}
            onClick={(e) => handleClick(e, url)}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      ))}
    </div>
  );
}

function getTimeAgo(t, locale, dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t('post.just_now');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('post.minutes_ago', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('post.hours_ago', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('post.days_ago', { n: diffDay });
  return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'short' });
}
