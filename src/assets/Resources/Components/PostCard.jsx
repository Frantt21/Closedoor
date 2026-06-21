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
import { FaHeart, FaRegHeart, FaComment, FaRetweet, FaThumbtack, FaEdit, FaTrash, FaEllipsisV, FaBookmark, FaRegBookmark, FaEye } from 'react-icons/fa';
import Badge from './Badge';
import SafeImage from './SafeImage';
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
  onLikeToggle,
  onRepostToggle,
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
  const [galleryUrls, setGalleryUrls] = useState(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
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
  const isPrivateProfile = profile?.is_private === true;
  const repostDisabled = isPrivateProfile && !isOwner;
  const timeAgo = getTimeAgo(t, locale, post.created_at);

  const handleLike = async (e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      const nowLiked = !liked;
      if (liked) {
        await unlikePost(post.id, user.id);
        setLiked(false);
        setLikesCount((c) => Math.max(c - 1, 0));
      } else {
        await likePost(post.id, user.id);
        setLiked(true);
        setLikesCount((c) => c + 1);
      }
      if (onLikeToggle) onLikeToggle(post.id, nowLiked);
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const handleRepost = async (e) => {
    e.stopPropagation();
    if (!user) return;
    try {
      const nowReposted = !reposted;
      if (reposted) {
        await unrepostPost(post.id, user.id);
        setReposted(false);
        setRepostsCount((c) => Math.max(c - 1, 0));
      } else {
        await repostPost(post.id, user.id);
        setReposted(true);
        setRepostsCount((c) => c + 1);
      }
      if (onRepostToggle) onRepostToggle(post.id, nowReposted);
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

  // Cerrar galería con Escape y navegar con flechas
  useEffect(() => {
    if (!galleryUrls) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { setGalleryUrls(null); return; }
      if (e.key === 'ArrowLeft') goGalleryPrev();
      if (e.key === 'ArrowRight') goGalleryNext();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [galleryUrls, galleryIndex]);

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

  // ── Obtener todas las URLs de imagen del post ──
  const getGalleryUrls = () => {
    const urls = (post.image_urls || (post.image_url ? [post.image_url] : []))
      .filter((url) => {
        if (!url) return false;
        const VID_RE = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i;
        return !VID_RE.test(url);
      });
    // También incluir inline media si existe y no hay image_urls/image_url
    if (urls.length === 0 && inlineMedia && inlineMedia.type === 'image') {
      urls.push(inlineMedia.url);
    }
    // Incluir legacy video_url que es imagen
    if (urls.length === 0 && post.video_url && !isVideo(post.video_url)) {
      urls.push(post.video_url);
    }
    return urls;
  };

  const openGallery = (e, index) => {
    e.stopPropagation();
    const urls = getGalleryUrls();
    if (urls.length === 0) return;
    setGalleryUrls(urls);
    setGalleryIndex(Math.min(index, urls.length - 1));
  };

  const goGalleryPrev = () => {
    setGalleryIndex((prev) => (prev > 0 ? prev - 1 : galleryUrls.length - 1));
  };

  const goGalleryNext = () => {
    setGalleryIndex((prev) => (prev < galleryUrls.length - 1 ? prev + 1 : 0));
  };

  const closeGallery = () => {
    setGalleryUrls(null);
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
          <p className="post-card-text">{renderContent(post.content, getSkipUrls(post), post.mentions, t)}</p>

          {/* Multiple images from post.image_urls (grid) */}
          {renderImageGrid(post, openGallery, t)}

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
              <SafeImage
                src={post.image_url}
                alt={t('post.media_alt', { n: 1 })}
                className="post-card-image"
                onClick={(e) => openGallery(e, 0)}
              />
            </div>
          )}

          {/* Legacy: image in post.video_url */}
          {post.video_url && !isVideo(post.video_url) && !post.image_url && (
            <div className="post-card-media">
              <SafeImage
                src={post.video_url}
                alt={t('post.media_alt', { n: 1 })}
                className="post-card-image"
                onClick={(e) => openGallery(e, 0)}
              />
            </div>
          )}

          {/* Legacy: inline media detection */}
          {inlineMedia && !post.image_url && !post.image_urls?.length && !post.video_url && (
            <div className="post-card-media">
              {inlineMedia.type === 'image' ? (
                <SafeImage
                  src={inlineMedia.url}
                  alt={t('post.media_alt', { n: 1 })}
                  className="post-card-image"
                  onClick={(e) => openGallery(e, 0)}
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
              className={`post-card-action ${reposted ? 'post-card-action--reposted' : ''} ${repostDisabled ? 'post-card-action--disabled' : ''}`}
              onClick={repostDisabled ? undefined : handleRepost}
              title={repostDisabled ? t('post.repost_private_forbidden') : ''}
              disabled={repostDisabled}
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

            <button type="button" className="post-card-action post-card-action--view">
              <span className="post-card-action-icon"><FaEye /></span>
              <span className="post-card-action-count">{post.views_count || 0}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Galería de imágenes ── */}
      {galleryUrls && (
        <div className="post-card-lightbox" onClick={(e) => { e.stopPropagation(); closeGallery(); }}>
          {/* Prev button */}
          {galleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--prev"
              onClick={(e) => { e.stopPropagation(); goGalleryPrev(); }}
              aria-label="Previous"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <div className="post-card-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="post-card-gallery-image-area">
              <SafeImage
                src={galleryUrls[galleryIndex]}
                alt={t('post.full_media')}
                className="post-card-gallery-image"
                key={galleryIndex}
                fallbackText={t('post.image_failed')}
              />
            </div>
            <div className="post-card-lightbox-actions">
              {galleryUrls.length > 1 && (
                <span className="post-card-gallery-counter">
                  {galleryIndex + 1} / {galleryUrls.length}
                </span>
              )}
              <a
                href={galleryUrls[galleryIndex]}
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
                href={galleryUrls[galleryIndex]}
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
                onClick={closeGallery}
                title={t('post.close')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Thumbnail strip ── */}
            {galleryUrls.length > 1 && (
              <div className="post-card-gallery-thumbnails">
                {galleryUrls.map((url, i) => (
                  <button
                    key={i}
                    className={`post-card-gallery-thumb ${i === galleryIndex ? 'post-card-gallery-thumb--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setGalleryIndex(i); }}
                    aria-label={`Go to image ${i + 1}`}
                  >
                    <div className="post-card-gallery-thumb-inner">
                      <SafeImage src={url} alt={`Thumbnail ${i + 1}`} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Next button */}
          {galleryUrls.length > 1 && (
            <button
              className="post-card-gallery-nav post-card-gallery-nav--next"
              onClick={(e) => { e.stopPropagation(); goGalleryNext(); }}
              aria-label="Next"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// ── Render @mentions, #hashtags and URLs as clickable links ──
function renderContent(text, skipUrls = [], mentions = {}, t = () => {}) {
  if (!text) return null;
  const skipSet = new Set(skipUrls);
  // Match @mentions, #hashtags and URLs
  const combinedRegex = /(?<![\w@])(@[a-zA-Z0-9_]+)|(?<![#\w])#([a-zA-Z0-9_\u00C0-\u024F]+)|(https?:\/\/[^\s<]+)/gi;
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
    if (part.startsWith('#')) {
      const tag = part.slice(1);
      return (
        <Link
          key={i}
          to={`/hashtag/${encodeURIComponent(tag)}`}
          className="post-card-hashtag"
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
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm(t('post.external_link_warning'))) {
              e.preventDefault();
            }
          }}
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
          <SafeImage
            src={url}
            alt={t('post.media_alt', { n: i + 1 })}
            onClick={(e) => handleClick(e, i)}
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
