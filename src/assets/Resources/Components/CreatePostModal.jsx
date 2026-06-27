import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPost, updatePost, notifyMentions } from '../../services/postService';
import { getFollowing } from '../../services/followService';
import { searchProfiles } from '../../services/userService';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { FaImage, FaTimes, FaPlus, FaLink, FaLock, FaUnlock, FaUserPlus, FaCheck, FaSearch, FaRegHeart, FaComment, FaRetweet, FaEye } from 'react-icons/fa';
import SafeImage from './SafeImage';
import Avatar from './Avatar';
import Badge from './Badge';
import { IMG_RE, VID_RE, YOUTUBE_PATTERN, VIMEO_PATTERN, extractUrls, detectMediaFromContent, getEmbedUrl as getEmbedUrlHelper } from '../../services/helpers';
import { encode as encryptEncode, encryptForUsers, decryptForUser, getObfuscatedDisplay } from '../../services/alphabetEncryption';
import { supabase } from '../../services/supabaseclient';
import './css/createPostModal.css';

const IMAGE_EXTENSIONS = IMG_RE;

export default function CreatePostModal({
  isOpen,
  onClose,
  onSuccess,
  editPost = null,
  userId,
}) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const currentUserId = userId; // alias para usar en callbacks
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

  // ── Encrypted post state ──
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [allowedUsers, setAllowedUsers] = useState([]); // { id, username, avatar_url }
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const userSearchTimeoutRef = useRef(null);

  // ── Cerrar con Escape ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const isEditing = !!editPost;

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
  // ── User search with debounce ──
  const handleUserSearchChange = useCallback((e) => {
    const query = e.target.value;
    setUserSearchQuery(query);
    if (query.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    if (userSearchTimeoutRef.current) clearTimeout(userSearchTimeoutRef.current);
    userSearchTimeoutRef.current = setTimeout(async () => {
      const results = await searchProfiles(query.trim(), currentUserId);
      // Filtrar los que ya están seleccionados
      const selectedIds = new Set(allowedUsers.map(u => u.id));
      setUserSearchResults(results.filter(u => !selectedIds.has(u.id)));
      setSearchingUsers(false);
    }, 300);
  }, [currentUserId, allowedUsers]);

  const addAllowedUser = useCallback((user) => {
    setAllowedUsers(prev => {
      if (prev.some(u => u.id === user.id)) return prev;
      return [...prev, { id: user.id, username: user.username, avatar_url: user.avatar_url }];
    });
    setUserSearchQuery('');
    setUserSearchResults([]);
    setShowUserSearch(false);
  }, []);

  const removeAllowedUser = useCallback((userId) => {
    setAllowedUsers(prev => prev.filter(u => u.id !== userId));
  }, []);

  // ── Reset all state when modal opens ──
  useEffect(() => {
    if (isOpen && userId) {
      getFollowing(userId)
        .then((users) => setFollowedUsers(users))
        .catch((err) => console.warn('Error fetching followed users:', err));
      setMentionIndex(-1);
      setMentionQuery('');
      setSelectedMentionIdx(0);
    }
  }, [isOpen, userId]);

  useEffect(() => {
    if (isOpen) {
      if (editPost) {
        setContent(editPost.content || '');
        updatePreview(editPost.content || '');
        const existingUrls = editPost.image_urls || (editPost.image_url ? [editPost.image_url] : []);
        setImageUrls(existingUrls.length > 0 ? existingUrls : ['']);
        setShowImageSection(existingUrls.length > 0);

        // ── Encrypted post: descifrar contenido + mantener estado ──
        const wasEncrypted = editPost.is_encrypted === true;
        setIsEncrypted(wasEncrypted);
        if (wasEncrypted && editPost.encrypted_content && userId) {
          // Descifrar el contenido para mostrarlo al autor
          decryptForUser(
            editPost.encrypted_content,
            editPost.encrypted_iv,
            editPost.user_id,
            editPost.allowed_users,
            userId
          ).then((decrypted) => {
            if (decrypted) setContent(decrypted);
          }).catch(() => {
            // Si falla el descifrado, mostrar lo que hay
          });

          // Cargar usuarios permitidos
          const allowedIds = editPost.allowed_users || [];
          if (allowedIds.length > 0) {
            // Filtrar el autor
            const others = allowedIds.filter(id => id !== userId);
            if (others.length > 0) {
              supabase
                .from('profiles')
                .select('id, username, avatar_url')
                .in('id', others)
                .then(({ data }) => {
                  if (data) setAllowedUsers(data);
                });
            }
          }
        }
      } else {
        setContent('');
        setPreviewUrl(null);
        setPreviewType(null);
        setImageUrls(['']);
        setShowImageSection(false);
        setIsEncrypted(false);
        setAllowedUsers([]);
        setUserSearchQuery('');
        setUserSearchResults([]);
        setShowUserSearch(false);
      }
      setError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editPost]);

  // ── Obfuscated preview (hook — debe ir antes del early return) ──
  const obfuscatedPreviewText = useMemo(() => {
    if (!isEncrypted || !content.trim() || isEditing) return null;
    try {
      return encryptEncode(content.trim());
    } catch {
      return null;
    }
  }, [isEncrypted, content, isEditing]);

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

    // Validar ofuscación: si está activa, debe haber al menos un usuario seleccionado
    if (isEncrypted && allowedUsers.length === 0) {
      setError(t('create_post.encrypted_no_users') || 'Selecciona al menos un usuario para ver el contenido ofuscado');
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
      let encryptedResult = null;
      let obfuscatedDisplay = null;

      // Si es modo ofuscado, encriptar el contenido
      if (isEncrypted && !isEditing) {
        obfuscatedDisplay = encryptEncode(trimmed);
      }

      if (isEditing) {
        const updateData = {
          content: trimmed,
          image_url: finalImageUrls[0] || imageUrl,
          image_urls: finalImageUrls.length > 0 ? finalImageUrls : null,
          video_url: videoUrl,
        };

        // Re-encriptar si el post estaba ofuscado
        if (isEncrypted) {
          const userIds = allowedUsers.map(u => u.id);
          if (!userIds.includes(userId)) {
            userIds.push(userId);
          }
          const encResult = await encryptForUsers(trimmed, userId, userIds);
          const encDisplay = encryptEncode(trimmed);
          const fullAllowedIds = [...new Set([...allowedUsers.map(u => u.id), userId])];
          updateData.content = encDisplay;
          updateData.is_encrypted = true;
          updateData.encrypted_content = encResult.ciphertext;
          updateData.encrypted_iv = encResult.iv;
          updateData.allowed_users = fullAllowedIds;
          updateData.obfuscated_display = encDisplay;
          encryptedResult = encResult;
          obfuscatedDisplay = encDisplay;
        }

        await updatePost(editPost.id, updateData);
      } else {
        if (!userId) {
          setError(t('create_post.auth_error'));
          setSaving(false);
          return;
        }

        // Si es modo ofuscado, encriptar con AES (clave derivada del autor + usuarios, sin postId)
        if (isEncrypted) {
          const userIds = allowedUsers.map(u => u.id);
          // Incluir al autor también para que pueda verlo
          if (!userIds.includes(userId)) {
            userIds.push(userId);
          }
          encryptedResult = await encryptForUsers(trimmed, userId, userIds);
        }

        // Incluir al autor en allowed_users (necesario para que coincida con la clave de encriptación)
        const fullAllowedIds = isEncrypted
          ? [...new Set([...allowedUsers.map(u => u.id), userId])]
          : null;

        newPost = await createPost({
          userId,
          content: isEncrypted ? obfuscatedDisplay : trimmed,
          imageUrl: finalImageUrls[0] || imageUrl,
          imageUrls: finalImageUrls.length > 0 ? finalImageUrls : null,
          videoUrl,
          encryptedContent: encryptedResult?.ciphertext || null,
          encryptedIv: encryptedResult?.iv || null,
          allowedUsers: fullAllowedIds,
          obfuscatedDisplay: isEncrypted ? obfuscatedDisplay : null,
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
      setIsEncrypted(false);
      setAllowedUsers([]);
      setUserSearchQuery('');
      setUserSearchResults([]);
      setShowUserSearch(false);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || t('create_post.save_error'));
    } finally {
      setSaving(false);
    }
  };

  const isVideoPreview = previewType === 'video' && (VID_RE.test(previewUrl) || YOUTUBE_PATTERN.test(previewUrl) || VIMEO_PATTERN.test(previewUrl));

  const getEmbedUrl = getEmbedUrlHelper;

  return (
    <div className="fc-modal-overlay" role="dialog" aria-modal="true" onClick={handleOverlayClick}>
      <div className="fc-modal create-post-modal">
        <div className="fc-modal-header">
          <h3 className="fc-modal-title">{isEditing ? t('create_post.edit_title') : t('create_post.title')}</h3>
        </div>

        {error && <p className="create-post-error">{error}</p>}

        {/* ── User info ── */}
        <div className="create-post-user">
          <Avatar
            className="create-post-avatar"
            src={profile?.avatar_url}
            alt={displayName}
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
              placeholder={t('create_post.placeholder')}
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
                  >                      <Avatar
                        className="create-post-mention-avatar"
                        src={user.avatar_url}
                        alt={user.username}
                      />
                    <span className="create-post-mention-username">{user.username}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="create-post-charcount">{content.length}/2000</span>
        </label>

        {/* ── Toolbar: icons + tooltips ── */}
        <div className="create-post-toolbar">
          <button
            type="button"
            className={`create-post-toolbar-btn ${showImageSection ? 'create-post-toolbar-btn--active' : ''}`}
            onClick={() => setShowImageSection((s) => !s)}
            title={showImageSection ? t('create_post.hide_media') : t('create_post.show_media')}
          >
            <FaImage />
            {getValidImageUrls().length > 0 && (
              <span className="create-post-toolbar-badge">{getValidImageUrls().length}</span>
            )}
          </button>

          <button
            type="button"
            className={`create-post-toolbar-btn ${isEncrypted ? 'create-post-toolbar-btn--encrypted' : ''}`}
            onClick={() => {
              if (isEditing) return; // No permitir cambiar en edición
              setIsEncrypted(s => !s);
              if (isEncrypted) {
                setAllowedUsers([]);
                setShowUserSearch(false);
              }
            }}
            title={
              isEditing
                ? (t('create_post.encrypted_edit_locked') || 'Post ofuscado — no se puede cambiar')
                : isEncrypted
                  ? (t('create_post.encrypted_on') || 'Ofuscado: ON')
                  : (t('create_post.encrypted_off') || 'Ofuscar contenido')
            }
          >
            {isEncrypted ? <FaLock /> : <FaUnlock />}
          </button>
        </div>

        {/* ── Allowed users selector (solo si ofuscación activa) ── */}
        {isEncrypted && (
          <div className="create-post-encrypt-section">
            <div className="create-post-encrypt-section-header">
              <FaUserPlus className="create-post-encrypt-section-icon" />
              <span className="create-post-encrypt-section-label">{t('create_post.allowed_users_title') || 'Visible para:'}</span>
              <button
                type="button"
                className="create-post-encrypt-add-btn"
                onClick={() => setShowUserSearch((s) => !s)}
                title={t('create_post.add_user') || 'Añadir usuario'}
              >
                <FaPlus />
              </button>
            </div>

            {/* Selected users as chips */}
            {allowedUsers.length > 0 && (
              <div className="create-post-encrypt-chips">
                {allowedUsers.map(u => (
                  <span key={u.id} className="create-post-encrypt-chip">
                    <Avatar className="create-post-encrypt-chip-avatar" src={u.avatar_url} alt={u.username} />
                    <span className="create-post-encrypt-chip-name">@{u.username}</span>
                    <button
                      type="button"
                      className="create-post-encrypt-chip-remove"
                      onClick={() => removeAllowedUser(u.id)}
                      title={t('common.delete')}
                    >
                      <FaTimes />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* User search */}
            {showUserSearch && (
              <div className="create-post-encrypt-search">
                <div className="create-post-encrypt-search-input-wrap">
                  <FaSearch className="create-post-encrypt-search-icon" />
                  <input
                    className="fc-modal-input create-post-encrypt-search-input"
                    type="text"
                    value={userSearchQuery}
                    onChange={handleUserSearchChange}
                    placeholder={t('create_post.search_users_placeholder') || 'Buscar usuarios...'}
                    autoFocus
                  />
                </div>

                {/* Search results */}
                {searchingUsers && <div className="create-post-encrypt-searching">{t('common.loading') || 'Buscando...'}</div>}
                {userSearchResults.length > 0 && (
                  <div className="create-post-encrypt-results">
                    {userSearchResults.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        className="create-post-encrypt-result-item"
                        onClick={() => addAllowedUser(u)}
                      >
                        <Avatar className="create-post-encrypt-result-avatar" src={u.avatar_url} alt={u.username} />
                        <span className="create-post-encrypt-result-name">@{u.username}</span>
                        <FaCheck className="create-post-encrypt-result-add" />
                      </button>
                    ))}
                  </div>
                )}
                {userSearchQuery.length >= 2 && userSearchResults.length === 0 && !searchingUsers && (
                  <div className="create-post-encrypt-no-results">{t('create_post.no_users_found') || 'Sin resultados'}</div>
                )}

                {/* Quick add: followed users */}
                {followedUsers.length > 0 && (
                  <div className="create-post-encrypt-quick">
                    <span className="create-post-encrypt-quick-label">{t('create_post.quick_add') || 'Siguiendo:'}</span>
                    <div className="create-post-encrypt-quick-list">
                      {followedUsers
                        .filter(u => !allowedUsers.some(a => a.id === u.id))
                        .slice(0, 6)
                        .map(u => (
                          <button
                            key={u.id}
                            type="button"
                            className="create-post-encrypt-quick-item"
                            onClick={() => addAllowedUser(u)}
                          >
                            <Avatar className="create-post-encrypt-quick-avatar" src={u.avatar_url} alt={u.username} />
                            <span className="create-post-encrypt-quick-name">@{u.username}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Image URL inputs section ── */}
        {showImageSection && (
          <div className="create-post-image-section">
            <div className="create-post-image-section-header">
              <FaLink className="create-post-image-section-icon" />
              <span className="create-post-image-section-label">{t('create_post.image_urls_title')}</span>
            </div>
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
                title={t('create_post.add_another_image', { n: imageUrls.length })}
              >
                <FaPlus />
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

        {/* ── Live Post Preview ── */}
        <div className="create-post-live-preview">
          <div className="create-post-live-preview-header">
            <span className="create-post-live-preview-label">{t('post.preview') || 'Vista previa'}</span>
          </div>
          <div className="create-post-live-preview-card">
            <Avatar
              className="create-post-live-preview-avatar"
              src={profile?.avatar_url}
              alt={displayName}
            />
            <div className="create-post-live-preview-content">
              <div className="create-post-live-preview-author">
                <span className="create-post-live-preview-username">{displayName}</span>
                <Badge roles={profile?.roles || []} />
              </div>
              <p className="create-post-live-preview-text">
                {content.trim() || <span className="create-post-live-preview-placeholder">{t('create_post.placeholder')}</span>}
              </p>
              {/* Preview images from image_urls */}
              {showImageSection && getValidImageUrls().length > 0 && (
                <div className={`post-card-image-grid post-card-image-grid--${Math.min(getValidImageUrls().length, 4)}`}>
                  {getValidImageUrls().slice(0, 4).map((url, i) => (
                    <div key={i} className="post-card-image-grid-item">
                      <SafeImage src={url} alt={`Preview ${i + 1}`} />
                    </div>
                  ))}
                </div>
              )}
              {/* Preview auto-detected media from content */}
              {previewUrl && previewType === 'image' && getValidImageUrls().length === 0 && (
                <div className="post-card-media">
                  <SafeImage src={previewUrl} alt="Preview" hideOnError />
                </div>
              )}
              {previewUrl && isVideoPreview && (
                <div className="post-card-media">
                  {getEmbedUrl(previewUrl) ? (
                    <iframe src={getEmbedUrl(previewUrl)} title="Video preview" allowFullScreen />
                  ) : (
                    <video src={previewUrl} controls />
                  )}
                </div>
              )}
              {/* Visual action buttons (disabled) */}
              <div className="create-post-live-preview-actions">
                <span className="create-post-live-preview-action">
                  <FaRegHeart /> <span className="create-post-live-preview-count">0</span>
                </span>
                <span className="create-post-live-preview-action">
                  <FaComment /> <span className="create-post-live-preview-count">0</span>
                </span>
                <span className="create-post-live-preview-action">
                  <FaRetweet /> <span className="create-post-live-preview-count">0</span>
                </span>
                <span className="create-post-live-preview-action">
                  <FaEye /> <span className="create-post-live-preview-count">0</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Obfuscated preview: cómo lo ven los no autorizados ── */}
        {obfuscatedPreviewText && !isEditing && (
          <div className="create-post-obfuscated-preview">
            <div className="create-post-obfuscated-preview-header">
              <FaLock className="create-post-obfuscated-preview-icon" />
              <span className="create-post-obfuscated-preview-label">
                {t('create_post.obfuscated_preview_label') || 'Cómo lo ven los demás usuarios:'}
              </span>
            </div>
            <div className="create-post-obfuscated-preview-card">
              <Avatar
                className="create-post-live-preview-avatar"
                src={profile?.avatar_url}
                alt={displayName}
              />
              <div className="create-post-live-preview-content">
                <div className="create-post-live-preview-author">
                  <span className="create-post-live-preview-username">{displayName}</span>
                  <Badge roles={profile?.roles || []} />
                </div>
                <p className="create-post-obfuscated-preview-text">
                  {getObfuscatedDisplay(obfuscatedPreviewText)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="fc-modal-actions">
          <button
            className="fc-modal-save"
            onClick={handleSubmit}
            disabled={saving || (!content.trim() && getValidImageUrls().length === 0)}
          >
            {isEncrypted && <FaLock className="fc-modal-save-lock" />}
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
