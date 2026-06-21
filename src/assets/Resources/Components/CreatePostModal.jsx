import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPost, updatePost, notifyMentions } from '../../services/postService';
import { getFollowing } from '../../services/followService';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { FaImage, FaTimes, FaPlus, FaLink } from 'react-icons/fa';
import SafeImage from './SafeImage';
import './css/createPostModal.css';

// ── Smart media detection ──
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i;
const YOUTUBE_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
const VIMEO_PATTERN = /vimeo\.com\/(\d+)/;
const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;

const DEFAULT_AVATAR = 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_PATTERN);
  return matches || [];
}

function detectMediaFromContent(text) {
  const urls = extractUrls(text);
  let imageUrl = null;
  let videoUrl = null;

  for (const url of urls) {
    if (videoUrl && imageUrl) break;
    if (!videoUrl && (VIDEO_EXTENSIONS.test(url) || YOUTUBE_PATTERN.test(url) || VIMEO_PATTERN.test(url))) {
      videoUrl = url;
    }
    if (!imageUrl && IMAGE_EXTENSIONS.test(url)) {
      imageUrl = url;
    }
  }

  return { imageUrl, videoUrl };
}

export default function CreatePostModal({
  isOpen,
  onClose,
  onSuccess,
  editPost = null,
  userId,
}) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewType, setPreviewType] = useState(null);
  const [imageUrls, setImageUrls] = useState(['']);
  const [showImageSection, setShowImageSection] = useState(false);
  const [mediaLimitWarning, setMediaLimitWarning] = useState(null);

  // ── @ Mention autocomplete ──
  const [followedUsers, setFollowedUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1); // cursor position where @ was typed
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const textareaRef = useRef(null);
  const mentionDropdownRef = useRef(null);

  const isEditing = !!editPost;

  const avatarUrl = profile?.avatar_url || DEFAULT_AVATAR;
  const displayName = profile?.username || t('common.username');

  // ── Image URL management (must be before updatePreview) ──
  const getValidImageUrls = () => {
    return imageUrls.filter((url) => url.trim() && IMAGE_EXTENSIONS.test(url.trim()));
  };

  // Preview the media found in current content
  const updatePreview = useCallback((text) => {
    const { imageUrl, videoUrl } = detectMediaFromContent(text);
    const validCount = getValidImageUrls().length;
    if (imageUrl || videoUrl) {
      if (validCount >= 4) {
        setMediaLimitWarning(t('create_post.media_limit_warning'));
        setPreviewUrl(null);
        setPreviewType(null);
        return;
      }
      setMediaLimitWarning(null);
      if (imageUrl) {
        setPreviewUrl(imageUrl);
        setPreviewType('image');
      } else if (videoUrl) {
        setPreviewUrl(videoUrl);
        setPreviewType('video');
      }
    } else {
      setPreviewUrl(null);
      setPreviewType(null);
      setMediaLimitWarning(null);
    }
  }, [t, imageUrls]);

  // ── Detectar @ y actualizar query de mención ──
  const updateMentionState = useCallback((text, cursorPos) => {
    if (cursorPos === undefined || cursorPos === null) {
      setMentionIndex(-1);
      return;
    }
    const beforeCursor = text.slice(0, cursorPos);
    const mentionMatch = beforeCursor.match(/(?<![\w@])@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      setMentionQuery(query);
      setMentionIndex(mentionMatch.index);
      setSelectedMentionIdx(0);
    } else {
      setMentionIndex(-1);
      setMentionQuery('');
    }
  }, []);

  // ── Fetch followed users when modal opens ──
  useEffect(() => {
    if (isOpen && userId && !editPost) {
      getFollowing(userId)
        .then((users) => setFollowedUsers(users))
        .catch((err) => console.warn('Error fetching followed users:', err));
      setMentionIndex(-1);
      setMentionQuery('');
      setSelectedMentionIdx(0);
    }
  }, [isOpen, userId, editPost]);

  useEffect(() => {
    if (isOpen) {
      if (editPost) {
        setContent(editPost.content || '');
        updatePreview(editPost.content || '');
        const existingUrls = editPost.image_urls || (editPost.image_url ? [editPost.image_url] : []);
        setImageUrls(existingUrls.length > 0 ? existingUrls : ['']);
        setShowImageSection(existingUrls.length > 0);
      } else {
        setContent('');
        setPreviewUrl(null);
        setPreviewType(null);
        setImageUrls(['']);
        setShowImageSection(false);
      }
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editPost]);

  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleContentChange = (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    setContent(text);
    updatePreview(text);
    updateMentionState(text, cursorPos);
  };

  // ── Manejar teclas en el textarea ──
  const handleTextareaKeyDown = (e) => {
    const filtered = getFilteredMentions();
    if (mentionIndex === -1 || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedMentionIdx((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedMentionIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filtered[selectedMentionIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionIndex(-1);
    }
  };

  // ── Obtener usuarios filtrados por query ──
  const getFilteredMentions = () => {
    if (mentionIndex === -1 || !followedUsers.length) return [];
    return followedUsers.filter(
      (u) => u.username && u.username.toLowerCase().includes(mentionQuery)
    ).slice(0, 8);
  };

  // ── Insertar mención en el texto ──
  const insertMention = (user) => {
    const before = content.slice(0, mentionIndex);
    const after = content.slice(mentionIndex);
    // Reemplazar @query con @username + espacio
    const restOfMention = after.match(/^@[a-zA-Z0-9_]*/);
    const afterMention = restOfMention ? after.slice(restOfMention[0].length) : after;
    const newContent = before + `@${user.username} ` + afterMention;
    setContent(newContent);
    setMentionIndex(-1);
    updatePreview(newContent);
    // Focus en textarea
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursor = before.length + user.username.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  // ── Image URL management ──
  const handleImageUrlChange = (index, value) => {
    setImageUrls((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const addImageUrlInput = () => {
    if (imageUrls.length >= 4) return;
    setImageUrls((prev) => [...prev, '']);
  };

  const removeImageUrlInput = (index) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed && getValidImageUrls().length === 0) {
      setError(t('create_post.empty_error'));
      return;
    }

    const { imageUrl, videoUrl } = detectMediaFromContent(trimmed);
    const validImageUrls = getValidImageUrls();

    // Merge auto-detected image with manual URLs (auto-detected takes priority if manual is empty)
    const finalImageUrls = validImageUrls.length > 0
      ? validImageUrls
      : (imageUrl ? [imageUrl] : []);

    setSaving(true);
    setError(null);

    try {
      let newPost;
      if (isEditing) {
        await updatePost(editPost.id, {
          content: trimmed,
          image_url: finalImageUrls[0] || imageUrl,
          image_urls: finalImageUrls.length > 0 ? finalImageUrls : null,
          video_url: videoUrl,
        });
      } else {
        if (!userId) {
          setError(t('create_post.auth_error'));
          setSaving(false);
          return;
        }
        newPost = await createPost({
          userId,
          content: trimmed,
          imageUrl: finalImageUrls[0] || imageUrl,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : null,
          videoUrl,
        });

        // ── @Mentions: notificar a usuarios mencionados ──
        if (trimmed && newPost?.id) {
          notifyMentions(userId, newPost.id, trimmed).catch((err) =>
            console.warn('Error notifying mentions:', err)
          );
        }
      }

      setContent('');
      setPreviewUrl(null);
      setPreviewType(null);
      setImageUrls(['']);
      setShowImageSection(false);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || t('create_post.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const isVideoPreview = previewType === 'video' && (VIDEO_EXTENSIONS.test(previewUrl) || YOUTUBE_PATTERN.test(previewUrl) || VIMEO_PATTERN.test(previewUrl));

  const getEmbedUrl = (url) => {
    if (!url) return null;
    const yt = url.match(YOUTUBE_PATTERN);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vm = url.match(VIMEO_PATTERN);
    if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
    return null;
  };

  return (
    <div className="fc-modal-overlay" role="dialog" aria-modal="true" onClick={handleOverlayClick}>
      <div className="fc-modal create-post-modal">
        <div className="fc-modal-header">
          <h3 className="fc-modal-title">{isEditing ? t('create_post.edit_title') : t('create_post.title')}</h3>
        </div>

        {error && <p className="create-post-error">{error}</p>}

        {/* ── User info ── */}
        <div className="create-post-user">
          <img
            className="create-post-avatar"
            src={avatarUrl}
            alt={displayName}
            onError={(e) => { e.target.src = DEFAULT_AVATAR; }}
          />
          <span className="create-post-username">{displayName}</span>
        </div>

        {/* ── Content textarea ── */}
        <label className="fc-modal-label">
          {t('create_post.content_label')}
          <div className="create-post-textarea-wrapper">
            <textarea
              ref={textareaRef}
              className="fc-modal-input create-post-textarea"
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleTextareaKeyDown}
              rows={5}
              placeholder={t('create_post.mention_hint')}
              maxLength={2000}
            />
            {/* ── @mention autocomplete dropdown ── */}
            {mentionIndex !== -1 && getFilteredMentions().length > 0 && (
              <div className="create-post-mention-dropdown" ref={mentionDropdownRef}>
                {getFilteredMentions().map((user, idx) => (
                  <button
                    key={user.id}
                    type="button"
                    className={`create-post-mention-item ${idx === selectedMentionIdx ? 'create-post-mention-item--active' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(user); }}
                  >
                    <img
                      className="create-post-mention-avatar"
                      src={user.avatar_url || DEFAULT_AVATAR}
                      alt={user.username}
                      onError={(e) => { e.target.src = DEFAULT_AVATAR; }}
                    />
                    <span className="create-post-mention-username">{user.username}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="create-post-charcount">{content.length}/2000</span>
        </label>

        {/* ── Image URL button (submodal) ── */}
        <div className="create-post-image-tools">
          <button
            type="button"
            className={`create-post-image-btn ${showImageSection ? 'create-post-image-btn--active' : ''}`}
            onClick={() => setShowImageSection((s) => !s)}
          >
            <FaImage />
            <span>{showImageSection ? t('create_post.hide_media') : t('create_post.show_media')}</span>
            {getValidImageUrls().length > 0 && (
              <span className="create-post-image-count">{t('create_post.image_count', { n: getValidImageUrls().length })}</span>
            )}
          </button>
        </div>

        {/* ── Image URL inputs section ── */}
        {showImageSection && (
          <div className="create-post-image-section">
            <p className="create-post-image-section-title">
              <FaLink /> {t('create_post.image_urls_title')}
            </p>
            {imageUrls.map((url, index) => (
              <div key={index} className="create-post-image-input-row">
                <input
                  className="fc-modal-input create-post-image-input"
                  type="url"
                  value={url}
                  onChange={(e) => handleImageUrlChange(index, e.target.value)}
                  placeholder={`https://.../imagen-${index + 1}.jpg`}
                />
                {imageUrls.length > 1 && (
                  <button
                    type="button"
                    className="create-post-image-remove"
                    onClick={() => removeImageUrlInput(index)}
                    title={t('common.delete')}
                  >
                    <FaTimes />
                  </button>
                )}
                {/* Mini preview */}
                {url && IMAGE_EXTENSIONS.test(url) && (
                  <div className="create-post-image-mini">
                    <SafeImage
                      src={url}
                      alt={`Preview ${index + 1}`}
                      hideOnError
                    />
                  </div>
                )}
              </div>
            ))}
            {imageUrls.length < 4 && (
              <button
                type="button"
                className="create-post-image-add"
                onClick={addImageUrlInput}
              >
                <FaPlus /> {t('create_post.add_another_image', { n: imageUrls.length })}
              </button>
            )}
          </div>
        )}

        {/* ── Aviso de límite de media alcanzado ── */}
        {mediaLimitWarning && (
          <div className="create-post-preview create-post-preview--warning">
            <span>{mediaLimitWarning}</span>
          </div>
        )}

        {/* ── Preview de media detectada en texto ── */}
        {previewUrl && previewType === 'image' && getValidImageUrls().length === 0 && (
          <div className="create-post-preview">
            <SafeImage
              src={previewUrl}
              alt="Preview"
              hideOnError
            />
          </div>
        )}

        {previewUrl && isVideoPreview && (
          <div className="create-post-preview create-post-preview--video">
            {getEmbedUrl(previewUrl) ? (
              <iframe
                src={getEmbedUrl(previewUrl)}
                title="Video preview"
                allowFullScreen
              />
            ) : (
              <video src={previewUrl} controls />
            )}
          </div>
        )}

        <div className="fc-modal-actions">
          <button
            className="fc-modal-save"
            onClick={handleSubmit}
            disabled={saving || (!content.trim() && getValidImageUrls().length === 0)}
          >
            {saving ? t('create_post.saving') : isEditing ? t('create_post.save_changes') : t('create_post.post')}
          </button>
          <button className="fc-modal-cancel" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
