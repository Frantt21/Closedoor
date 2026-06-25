import React, { useEffect, useState } from 'react';
import './css/modal.css';
import '../Styles/explore.css';
import Badge from './Badge';
import ConfirmModal from './ConfirmModal';
import Avatar from './Avatar';
import { DEFAULT_AVATAR } from '../../services/helpers';
import { detectPlatform, getPlatformIcon, getPlatformName } from '../../services/socialPlatforms';
import { extractColors } from '../../services/colorExtractor';
import { useI18n } from '../../services/i18n/useI18n';
import { FaCamera } from 'react-icons/fa';
import ImagePositionEditor from './ImagePositionEditor';

// Module-level color cache persists across modal mounts/unmounts
const colorCache = {};

// Lista curada de intereses generales sugeridos
const SUGGESTED_INTERESTS = [
  'Videojuegos', 'Películas', 'Música', 'Arte', 'Fotografía',
  'Deportes', 'Lectura', 'Escritura', 'Viajes', 'Cocina',
  'Tecnología', 'Ciencia', 'Naturaleza', 'Animales', 'Moda',
  'Diseño', 'Baile', 'Teatro', 'Yoga', 'Meditación',
  'Cine', 'Series', 'Anime', 'Manga', 'Cómics',
  'Programación', 'IA', 'Ciberseguridad', 'Blockchain', 'Data Science',
  'Fitness', 'Running', 'Fútbol', 'Baloncesto', 'Tenis',
  'Natación', 'Senderismo', 'Acampar', 'Pesca', 'Jardinería',
  'DIY', 'Manualidades', 'Coleccionismo', 'Astronomía', 'Historia',
  'Filosofía', 'Psicología', 'Economía', 'Política', 'Medio Ambiente',
  'Voluntariado', 'Idiomas', 'Mascotas', 'Autos', 'Motos',
  'Rock', 'Pop', 'Hip Hop', 'Jazz', 'Electrónica',
  'Reggaeton', 'K-Pop', 'Instrumentos', 'Piano', 'Guitarra',
  'Batería', 'Producción Musical', 'DJ', 'Podcast', 'Streaming',
  'YouTube', 'TikTok', 'Redes Sociales', 'Marketing', 'Emprendimiento',
  'Negocios', 'Inversiones', 'Bienes Raíces', 'Arquitectura', 'Decoración',
  'Ilustración', 'Pixel Art', '3D', 'Animación', 'Edición de Video',
  'Astrología', 'Desarrollo Personal', 'Minimalismo', 'Sostenibilidad', 'Criptomonedas'
];

export default function Modal({
  isOpen,
  onClose,
  onSave,
  initialUsername = '',
  initialBanner = '',
  initialAvatar = '',
  initialBio = '',
  initialSocialLinks = [],
  initialAccentColor = '',
  initialAccentColorSecondary = '',
  initialInterests = [],
  initialBannerPosition = '50% 50%',
  initialAvatarPosition = '50% 50%',
  initialAccentSurface = '',
  initialAccentSurfaceGlass = false,
  initialProfileBg = '',
  initialProfileBgPosition = '50% 50%',
  initialProfileBgBlur = 0,
  initialProfileBgDim = 50,
  initialFollowersCount = 0,
  userRoles = ['user'],
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initialUsername);
  const [banner, setBanner] = useState(initialBanner);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [bio, setBio] = useState(initialBio);
  const [saving, setSaving] = useState(false);
  const [socialLinks, setSocialLinks] = useState([]);
  const [newSocial, setNewSocial] = useState('');
  const [socialError, setSocialError] = useState('');
  const [detected, setDetected] = useState(null); // { platform, username, url } preview before adding
  const [detectedUsername, setDetectedUsername] = useState('');

  // Auto-detect platform as user types
  useEffect(() => {
    const input = newSocial.trim();
    if (!input) {
      setDetected(null);
      setSocialError('');
      return;
    }
    const result = detectPlatform(input);
    if (result && result.platform.id !== 'custom' && result.platform.id !== 'website') {
      setDetected(result);
      setDetectedUsername(result.username);
      setSocialError('');
    } else {
      setDetected(null);
      setSocialError('');
    }
  }, [newSocial]);
  const [extractedColors, setExtractedColors] = useState(() => {
    // Restore from cache on mount (no flash)
    const cached = initialBanner ? colorCache[initialBanner.trim()] : null;
    return cached || [];
  });
  const [selectedAccent, setSelectedAccent] = useState(initialAccentColor);
  const [selectedAccentSecondary, setSelectedAccentSecondary] = useState(initialAccentColorSecondary);
  const [selectedAccentSurface, setSelectedAccentSurface] = useState(initialAccentSurface);
  const [useGlassSurface, setUseGlassSurface] = useState(initialAccentSurfaceGlass);
  const [profileBg, setProfileBg] = useState(initialProfileBg);
  const [profileBgPosition, setProfileBgPosition] = useState(initialProfileBgPosition);
  const [profileBgBlur, setProfileBgBlur] = useState(initialProfileBgBlur);
  const [profileBgDim, setProfileBgDim] = useState(initialProfileBgDim);
  const [interests, setInterests] = useState(initialInterests);
  const [interestInput, setInterestInput] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [extracting, setExtracting] = useState(false);
  // Image position state
  const [bannerPosition, setBannerPosition] = useState(initialBannerPosition);
  const [avatarPosition, setAvatarPosition] = useState(initialAvatarPosition);
  // Submodal state: null | { type: 'avatar' | 'banner', value: string }
  const [showUrlModal, setShowUrlModal] = useState(null);
  const [urlInput, setUrlInput] = useState('');
  const [showSuggested, setShowSuggested] = useState(false);
  const [showProfileBgSubmodal, setShowProfileBgSubmodal] = useState(null);
  const [profileBgUrlInput, setProfileBgUrlInput] = useState('');
  const [pendingClose, setPendingClose] = useState(false);

  useEffect(() => {
    setUsername(initialUsername || '');
    setBanner(initialBanner || '');
    setAvatar(initialAvatar || '');
    setBio(initialBio || '');
    setSocialLinks(Array.isArray(initialSocialLinks) ? initialSocialLinks : []);
    setSelectedAccent(initialAccentColor || '');
    setSelectedAccentSecondary(initialAccentColorSecondary || '');
    setSelectedAccentSurface(initialAccentSurface || '');
    setUseGlassSurface(initialAccentSurfaceGlass);
    setInterests(Array.isArray(initialInterests) ? initialInterests : []);
    setInterestInput('');
    setNewSocial('');
    setSocialError('');
    setShowUrlModal(null);
    setUrlInput('');
    setHasChanges(false);
    setShowSuggested(false);
    setSelectedAccentSurface(initialAccentSurface || '');
    setProfileBg(initialProfileBg || '');
    setProfileBgPosition(initialProfileBgPosition);
    setProfileBgBlur(initialProfileBgBlur);
    setProfileBgDim(initialProfileBgDim);
    setBannerPosition(initialBannerPosition);
    setAvatarPosition(initialAvatarPosition);
    // Restore cached colors immediately (no flash)
    const cached = initialBanner ? colorCache[initialBanner.trim()] : null;
    if (cached) {
      setExtractedColors(cached);
    } else {
      setExtractedColors([]);
    }
  }, [initialUsername, initialBanner, initialAvatar, initialBio, initialSocialLinks, initialAccentColor, initialBannerPosition, initialAvatarPosition, isOpen]);

  // ── Detectar cambios pendientes ──
  useEffect(() => {
    const changed =
      username !== (initialUsername || '') ||
      banner !== (initialBanner || '') ||
      avatar !== (initialAvatar || '') ||
      bio !== (initialBio || '') ||
      JSON.stringify(socialLinks) !== JSON.stringify(initialSocialLinks || []) ||
      selectedAccent !== (initialAccentColor || '') ||
      selectedAccentSecondary !== (initialAccentColorSecondary || '') ||
      selectedAccentSurface !== (initialAccentSurface || '') ||
      useGlassSurface !== !!initialAccentSurfaceGlass ||
      profileBg !== (initialProfileBg || '') ||
      profileBgPosition !== initialProfileBgPosition ||
      profileBgBlur !== initialProfileBgBlur ||
      profileBgDim !== initialProfileBgDim ||
      JSON.stringify(interests) !== JSON.stringify(initialInterests || []) ||
      bannerPosition !== initialBannerPosition ||
      avatarPosition !== initialAvatarPosition;
    setHasChanges(changed);
  }, [
    username, banner, avatar, bio, socialLinks,    selectedAccent, selectedAccentSecondary, interests,
    bannerPosition, avatarPosition,
    initialUsername, initialBanner, initialAvatar, initialBio,
    initialSocialLinks, initialAccentColor, initialAccentColorSecondary, initialAccentSurface, initialAccentSurfaceGlass, initialProfileBg, initialProfileBgPosition, initialProfileBgBlur, initialProfileBgDim, initialInterests,
    initialBannerPosition, initialAvatarPosition
  ]);

  // Extract colors when banner URL changes (with cache)
  useEffect(() => {
    const bannerUrl = banner.trim();
    if (!bannerUrl) {
      setExtractedColors([]);
      return;
    }

    const cached = colorCache[bannerUrl];
    if (cached) {
      setExtractedColors(cached);
      if (!selectedAccent) {
        setSelectedAccent(cached[0]);
      }
      setExtracting(false);
      return;
    }

    let cancelled = false;
    setExtracting(true);

    extractColors(bannerUrl)
      .then((colors) => {
        if (!cancelled && colors.length >= 4) {
          setExtractedColors(colors);
          colorCache[bannerUrl] = colors;
          if (!selectedAccent) {
            setSelectedAccent(colors[0]);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });

    return () => { cancelled = true; };
  }, [banner]);

  const confirmClose = () => {
    if (hasChanges) {
      setPendingClose(true);
    } else {
      onClose();
    }
  };

  const executeClose = () => {
    setPendingClose(false);
    onClose();
  };

  // ── Cerrar al hacer click fuera del modal ──
  // (onClick en el overlay en el return)

  // ── Cerrar con Escape (modal principal) ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') confirmClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasChanges, onClose, t]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        username: username.trim(),
        avatar_url: avatar.trim() || null,
        banner_url: banner.trim() || null,
        bio: bio.trim(),
        social_links: socialLinks,
        accent_color: selectedAccent || null,
        accent_color_secondary: selectedAccentSecondary || null,
        accent_surface_color: selectedAccentSurface || null,
        accent_surface_glass: useGlassSurface,
        interests: interests,
        banner_position: bannerPosition,
        avatar_position: avatarPosition,
        profile_background_url: profileBg.trim() || null,
        profile_background_position: profileBgPosition,
        profile_background_blur: profileBgBlur,
        profile_background_dim: profileBgDim,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddSocial = () => {
    if (!detected) {
      setSocialError(t('modal.social_detect_error'));
      return;
    }
    const username = detectedUsername.trim();
    if (!username) {
      setSocialError(t('modal.social_detect_error'));
      return;
    }
    // Rebuild URL with possibly edited username
    const finalUrl = detected.platform.urlTemplate(username);
    if (socialLinks.some((s) => s.url === finalUrl)) {
      setSocialError(t('modal.social_duplicate'));
      return;
    }
    setSocialLinks((prev) => [...prev, {
      platform: detected.platform.id,
      username,
      url: finalUrl,
    }]);
    setNewSocial('');
    setDetected(null);
    setDetectedUsername('');
    setSocialError('');
  };

  const handleCancelDetected = () => {
    setDetected(null);
    setDetectedUsername('');
    setNewSocial('');
    setSocialError('');
  };

  const handleRemoveSocial = (index) => {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSocialKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSocial();
    }
  };

  // ── Submodal URL editing ──
  const handleOpenUrlModal = (type) => {
    setUrlInput(type === 'avatar' ? avatar : banner);
    setShowUrlModal(type);
  };

  const handleUrlModalSave = () => {
    const url = urlInput.trim();
    if (showUrlModal === 'avatar') setAvatar(url);
    else if (showUrlModal === 'banner') setBanner(url);
    setShowUrlModal(null);
    setUrlInput('');
  };

  const handleUrlModalKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleUrlModalSave(); }
    else if (e.key === 'Escape') setShowUrlModal(null);
  };

  // ── Profile Background submodal ──
  const handleOpenProfileBgModal = () => {
    setProfileBgUrlInput(profileBg);
    setShowProfileBgSubmodal(true);
  };

  const handleProfileBgModalSave = () => {
    const url = profileBgUrlInput.trim();
    setProfileBg(url);
    if (url && !profileBgPosition) setProfileBgPosition('50% 50%');
    setShowProfileBgSubmodal(null);
    setProfileBgUrlInput('');
  };

  const handleProfileBgUrlKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleProfileBgModalSave(); }
    else if (e.key === 'Escape') setShowProfileBgSubmodal(null);
  };

  const BIO_MAX_LENGTH = 80;
  const defaultAvatar = DEFAULT_AVATAR;
  const previewUsername = username || 'username';

  return (      <div className="fc-modal-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) confirmClose(); }}>
      <div className="fc-modal">
        {/* ── Header bar: title + actions ── */}
        <div className="fc-modal-header">
          <h3 className="fc-modal-title">{t('modal.edit_title')}</h3>
          <div className="fc-modal-header-actions">
            <button className="fc-modal-save" onClick={handleSave} disabled={saving}>
              {saving ? t('modal.saving') : t('modal.save')}
            </button>
            <button className="fc-modal-close" onClick={confirmClose} disabled={saving} title={t('modal.cancel')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Two-column grid layout ── */}
        <div className="fc-modal-grid">
          {/* ── LEFT COLUMN ── */}
          <div className="fc-modal-grid-left">
            {/* ── Preview Card (grande) ── */}
            <div className="fc-preview-card fc-preview-card--large"
              style={{
                '--accent-color': selectedAccent || 'transparent',
                '--accent-color-2': selectedAccentSecondary || selectedAccent || 'transparent',
              }}
            >
              <div
                className="fc-preview-card-banner"
                style={banner ? { backgroundImage: `url(${banner})`, backgroundPosition: bannerPosition } : {}}
              >
                <div className="fc-preview-card-overlay"></div>
                {/* Edit banner icon — top right */}
                <button
                  type="button"
                  className="fc-preview-banner-edit"
                  onClick={(e) => { e.stopPropagation(); handleOpenUrlModal('banner'); }}
                  title={t('modal.edit_banner')}
                >
                  <FaCamera />
                </button>

                <div className="fc-preview-card-avatar">
                  <img
                    src={avatar || defaultAvatar}
                    alt="Preview"
                    onError={(e) => { e.target.src = defaultAvatar; }}
                  />
                  {/* Edit avatar icon — centered on avatar */}
                  <button
                    type="button"
                    className="fc-preview-avatar-edit"
                    onClick={(e) => { e.stopPropagation(); handleOpenUrlModal('avatar'); }}
                    title={t('modal.edit_avatar')}
                  >
                    <FaCamera />
                  </button>
                </div>

                <div className="fc-preview-card-info">
                  <span className="fc-preview-card-name">{previewUsername}</span>
                  <Badge roles={userRoles} />
                </div>
              </div>
            </div>

            {/* ── URL submodal con posicionador ── */}
            {showUrlModal && (
              <div className="fc-modal-sub-overlay">
                <div className="fc-modal-sub" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowUrlModal(null); }} onClick={(e) => e.stopPropagation()}>
                  <h4 className="fc-modal-sub-title">
                    {showUrlModal === 'avatar' ? t('modal.avatar_url') : t('modal.banner_url')}
                  </h4>
                  <input
                    className="fc-modal-input fc-modal-sub-input"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={handleUrlModalKeyDown}
                    placeholder={showUrlModal === 'avatar' ? 'https://.../avatar.jpg' : 'https://.../banner.jpg'}
                    autoFocus
                  />
                  {/* ── Image position editor ── */}
                  {urlInput.trim() && (
                    <div style={{ marginTop: 10 }}>
                      <ImagePositionEditor
                        key={`pos-editor-${showUrlModal}`}
                        imageUrl={urlInput.trim()}
                        initialPosition={showUrlModal === 'avatar' ? avatarPosition : bannerPosition}
                        aspectRatio={showUrlModal === 'avatar' ? 1 : 40 / 11}
                        onPositionChange={(pos) => {
                          if (showUrlModal === 'avatar') setAvatarPosition(pos);
                          else setBannerPosition(pos);
                        }}
                      />
                    </div>
                  )}
                  <div className="fc-modal-sub-actions">
                    <button type="button" className="fc-modal-sub-save" onClick={handleUrlModalSave} disabled={!urlInput.trim()}>
                      {t('modal.apply')}
                    </button>
                    <button type="button" className="fc-modal-sub-cancel" onClick={() => setShowUrlModal(null)}>
                      {t('modal.cancel')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Username input */}
            <label className="fc-modal-label">
              {t('modal.username_label')}
              <input
                className="fc-modal-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
              />
            </label>

            {/* Bio */}
            <label className="fc-modal-label">
              {t('modal.bio_label')}
              <textarea
                className="fc-modal-input"
                value={bio}
                onChange={(e) => {
                  if (e.target.value.length <= BIO_MAX_LENGTH) setBio(e.target.value);
                }}
                rows={2}
                maxLength={BIO_MAX_LENGTH}
                placeholder={t('modal.bio_label')}
              />
              <span className="fc-modal-char-count">
                {bio.length}/{BIO_MAX_LENGTH}
              </span>
            </label>

            {/* ── Interests ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.interests')}</label>

              {/* Input + add button */}
              <div className="fc-modal-interests-input-row">
                <input
                  className="fc-modal-input fc-modal-interests-input"
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = interestInput.trim();
                      if (val && !interests.includes(val)) {
                        setInterests((prev) => [...prev, val]);
                      }
                      setInterestInput('');
                    }
                  }}
                  placeholder={t('modal.interests_placeholder')}
                />
                <button
                  type="button"
                  className="fc-modal-interests-add"
                  onClick={() => {
                    const val = interestInput.trim();
                    if (val && !interests.includes(val)) {
                      setInterests((prev) => [...prev, val]);
                    }
                    setInterestInput('');
                  }}
                  disabled={!interestInput.trim()}
                >
                  +
                </button>
              </div>

              {/* Pills de intereses seleccionados */}
              {interests.length > 0 && (
                <div className="fc-modal-interests-pills">
                  {interests.map((interest, i) => (
                    <span key={i} className="fc-modal-interest-pill">
                      {interest}
                      <button
                        type="button"
                        className="fc-modal-interest-pill-remove"
                        onClick={() => setInterests((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* ── Lista de intereses sugeridos (expandible) ── */}
              <div className="fc-modal-suggested-wrapper">
                <button
                  type="button"
                  className="fc-modal-suggested-toggle"
                  onClick={() => setShowSuggested((prev) => !prev)}
                >
                  <span>{t('modal.suggested_interests')}</span>
                  <svg
                    className={`fc-modal-suggested-chevron ${showSuggested ? 'fc-modal-suggested-chevron--open' : ''}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div className={`fc-modal-suggested-collapse ${showSuggested ? 'fc-modal-suggested-collapse--open' : ''}`}>
                  <div className="fc-modal-suggested-list">
                    {SUGGESTED_INTERESTS.filter((s) => !interests.includes(s)).map((interest) => (
                      <button
                        key={interest}
                        type="button"
                        className="fc-modal-suggested-chip"
                        onClick={() => setInterests((prev) => [...prev, interest])}
                      >
                        + {interest}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Social Links ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.social_links')}</label>
              <div className="fc-modal-social-input-row">
                <input
                  className="fc-modal-input fc-modal-social-input"
                  value={newSocial}
                  onChange={(e) => { setNewSocial(e.target.value); setSocialError(''); }}
                  onKeyDown={handleSocialKeyDown}
                  placeholder={t('modal.social_placeholder')}
                />
                <button
                  type="button"
                  className="fc-modal-social-add"
                  onClick={handleAddSocial}
                  disabled={!detected}
                >
                  {detected ? t('modal.social_add') : '+'}
                </button>
              </div>
              {socialError && <p className="fc-modal-social-error">{socialError}</p>}

              {detected && (
                <div className="fc-modal-social-detected">
                  <span className="fc-modal-social-detected-icon">
                    {React.createElement(getPlatformIcon(detected.platform.id))}
                  </span>
                  <span className="fc-modal-social-detected-name">{getPlatformName(detected.platform.id)}</span>
                  <input
                    className="fc-modal-input fc-modal-social-detected-input"
                    value={detectedUsername}
                    onChange={(e) => setDetectedUsername(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="fc-modal-social-detected-cancel"
                    onClick={handleCancelDetected}
                    title={t('common.cancel')}
                  >
                    ×
                  </button>
                </div>
              )}
              {socialLinks.length > 0 && (
                <ul className="fc-modal-social-list">
                  {socialLinks.map((link, i) => (
                    <li key={i} className="fc-modal-social-item">
                      <span className="fc-modal-social-icon">{React.createElement(getPlatformIcon(link.platform))}</span>
                      <span className="fc-modal-social-platform">{link.platform}</span>
                      <span className="fc-modal-social-username">@{link.username}</span>
                      <button
                        type="button"
                        className="fc-modal-social-remove"
                        onClick={() => handleRemoveSocial(i)}
                        title={t('common.delete')}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="fc-modal-social-hint">{t('modal.social_example')}</p>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Explore card preview + Accent colors + Surface color ── */}
          <div className="fc-modal-grid-right">
            {/* ── Explore card preview (reusa las clases reales de explore.css) ── */}
            <div className={`explore-card${(selectedAccent || selectedAccentSecondary) ? ' explore-card--accent' : ''}`}
              style={{
                '--accent-color': selectedAccent || 'transparent',
                '--accent-color-2': selectedAccentSecondary || selectedAccent || 'transparent',
                marginBottom: 16,
              }}
            >
              <div className="explore-card-banner">
                {banner.trim() ? (
                  <img
                    className="explore-card-banner-img"
                    src={banner.trim()}
                    alt=""
                    style={{ objectPosition: bannerPosition }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'var(--color-surface-hover, #252525)' }} />
                )}
                <div className="explore-card-overlay" />
              </div>

              <div className="explore-card-body">
                <img
                  className="explore-card-avatar"
                  src={avatar || defaultAvatar}
                  alt=""
                  onError={(e) => { e.target.src = defaultAvatar; }}
                />

                <div className="explore-card-info">
                  <div className="explore-card-name-row">
                    <span className="explore-card-name">{previewUsername}</span>
                    <Badge roles={userRoles} />
                  </div>
                  <span className="explore-card-followers">
                    {initialFollowersCount} {initialFollowersCount === 1 ? t('explore.followers_singular') : t('explore.followers_plural')}
                  </span>
                  {bio.trim() && (
                    <p className="explore-card-bio">{bio.trim()}</p>
                  )}

                  {/* ── Interests (max 3, then "see more" → profile) ── */}
                  {interests?.length > 0 && (
                    <div className="explore-card-interests">
                      {interests.slice(0, 3).map((interest, i) => (
                        <span key={i} className="explore-card-interest">{interest}</span>
                      ))}
                      {interests.length > 3 && (
                        <button
                          type="button"
                          className="explore-card-interests-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `/profile/${username}`;
                          }}
                        >
                          {t('profile.show_more', { count: interests.length - 3 })}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="explore-card-action">
                  <button type="button" className="follow-btn follow-btn--follow" disabled>
                    {t('follow.follow')}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Accent Color — swatches + custom picker integrado ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.accent_color')}</label>

              {banner.trim() && extracting && (
                <p className="fc-modal-social-hint">{t('modal.extracting_colors')}</p>
              )}
              {banner.trim() && !extracting && extractedColors.length < 4 && (
                <p className="fc-modal-social-hint">{t('modal.add_banner_hint')}</p>
              )}

              <div className="fc-modal-color-picker">
                {banner.trim() && !extracting && extractedColors.length >= 4 && extractedColors.map((color, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`fc-modal-color-swatch ${selectedAccent === color ? 'fc-modal-color-swatch--selected' : ''}`}
                    style={{ '--swatch-color': color }}
                    onClick={() => setSelectedAccent(color)}
                    title={`${t('modal.accent_color')}: ${color}`}
                  >
                    {selectedAccent === color && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}

                <div className="fc-modal-color-swatch fc-modal-custom-swatch"
                  onClick={() => document.getElementById('accent-color-input')?.click()}
                  title={`${t('modal.accent_color_custom')}: ${selectedAccent || '#000000'}`}
                >
                  <input
                    id="accent-color-input"
                    type="color"
                    value={selectedAccent || '#000000'}
                    onChange={(e) => setSelectedAccent(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)', whiteSpace: 'nowrap', alignSelf: 'center' }}>
                  {t('modal.accent_color_custom')}
                </span>
              </div>

              {selectedAccent && extractedColors.length > 0 && !extractedColors.includes(selectedAccent) && (
                <button
                  type="button"
                  onClick={() => setSelectedAccent(extractedColors[0] || '')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted, #6b7280)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    padding: '2px 0',
                    marginTop: 4,
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  {t('common.reset')}
                </button>
              )}
            </div>

            {/* ── Secondary accent color picker ── */}
            <div className="fc-modal-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #6b7280)', whiteSpace: 'nowrap' }}>
                  {t('modal.accent_color_secondary')}
                </label>
                <div
                  onClick={() => document.getElementById('accent-secondary-input')?.click()}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: selectedAccentSecondary || '#000000',
                    border: '2px solid var(--color-border, #2a2a2a)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  title={`${t('modal.accent_color_secondary')}: ${selectedAccentSecondary || '#000000'}`}
                />
                <input
                  id="accent-secondary-input"
                  type="color"
                  value={selectedAccentSecondary || '#000000'}
                  onChange={(e) => setSelectedAccentSecondary(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                />
                {selectedAccentSecondary && (
                  <button
                    type="button"
                    onClick={() => setSelectedAccentSecondary('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted, #6b7280)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    {t('common.clear')}
                  </button>
                )}
              </div>
            </div>

            {/* ── Surface color picker + Glass mode toggle ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.accent_surface')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div
                  onClick={() => document.getElementById('accent-surface-input')?.click()}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: selectedAccentSurface || 'rgba(28, 28, 30, 0.7)',
                    border: selectedAccentSurface ? '2px solid var(--color-border, #2a2a2a)' : '2px dashed var(--color-text-muted, #6b7280)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  title={`${t('modal.accent_surface')}: ${selectedAccentSurface || t('modal.accent_surface_default')}`}
                />
                <input
                  id="accent-surface-input"
                  type="color"
                  value={selectedAccentSurface || '#1c1c1e'}
                  onChange={(e) => setSelectedAccentSurface(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #6b7280)' }}>
                  {selectedAccentSurface ? selectedAccentSurface : t('modal.accent_surface_default')}
                </span>
                {selectedAccentSurface && (
                  <button
                    type="button"
                    onClick={() => setSelectedAccentSurface('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted, #6b7280)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    {t('common.clear')}
                  </button>
                )}
              </div>
              {/* ── Glass mode toggle ── */}
              <div className="fc-modal-glass-toggle">
                <span className="fc-modal-glass-toggle-label">{t('modal.accent_surface_glass')}</span>
                <button
                  type="button"
                  className={`fc-modal-glass-switch ${useGlassSurface ? 'fc-modal-glass-switch--on' : ''}`}
                  onClick={() => setUseGlassSurface((prev) => !prev)}
                  role="switch"
                  aria-checked={useGlassSurface}
                >
                  <div className="fc-modal-glass-switch-knob" />
                </button>
              </div>
            </div>

            {/* ── Profile Background ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.profile_background')}</label>

              <div className="fc-modal-bg-preview-row">
                {profileBg.trim() ? (
                  <div
                    className="fc-modal-bg-thumb"
                    style={{ backgroundImage: `url(${profileBg.trim()})`, backgroundPosition: profileBgPosition }}
                  />
                ) : (
                  <div className="fc-modal-bg-thumb fc-modal-bg-thumb--empty">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                )}
                <button
                  type="button"
                  className="fc-modal-bg-edit-btn"
                  onClick={handleOpenProfileBgModal}
                  title={t('modal.profile_bg_edit')}
                >
                  <FaCamera />
                </button>
              </div>

              {profileBg.trim() && (
                <>
                  {/* Blur slider */}
                  <div className="fc-modal-range-row">
                    <span className="fc-modal-range-label">{t('modal.profile_bg_blur')}</span>
                    <div className="fc-modal-range-control">
                      <input
                        type="range"
                        min="0"
                        max="20"
                        step="2"
                        value={profileBgBlur}
                        onChange={(e) => setProfileBgBlur(Number(e.target.value))}
                        className="fc-modal-range"
                      />
                      <span className="fc-modal-range-value">{profileBgBlur}px</span>
                    </div>
                  </div>
                  {/* Dim slider */}
                  <div className="fc-modal-range-row">
                    <span className="fc-modal-range-label">{t('modal.profile_bg_dim')}</span>
                    <div className="fc-modal-range-control">
                      <input
                        type="range"
                        min="0"
                        max="80"
                        step="5"
                        value={profileBgDim}
                        onChange={(e) => setProfileBgDim(Number(e.target.value))}
                        className="fc-modal-range"
                      />
                      <span className="fc-modal-range-value">{profileBgDim}%</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Profile Background URL submodal ── */}
        {showProfileBgSubmodal && (
          <div className="fc-modal-sub-overlay">
            <div className="fc-modal-sub" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowProfileBgSubmodal(null); }} onClick={(e) => e.stopPropagation()}>
              <h4 className="fc-modal-sub-title">{t('modal.profile_background')}</h4>
              <input
                className="fc-modal-input fc-modal-sub-input"
                value={profileBgUrlInput}
                onChange={(e) => setProfileBgUrlInput(e.target.value)}
                onKeyDown={handleProfileBgUrlKeyDown}
                placeholder="https://.../background.jpg"
                autoFocus
              />
              {profileBgUrlInput.trim() && (
                <div style={{ marginTop: 10 }}>
                  <ImagePositionEditor
                    key={`bg-pos-${showProfileBgSubmodal}`}
                    imageUrl={profileBgUrlInput.trim()}
                    initialPosition={profileBgPosition}
                    aspectRatio={16 / 9}
                    onPositionChange={(pos) => setProfileBgPosition(pos)}
                  />
                </div>
              )}
              <div className="fc-modal-sub-actions">
                <button type="button" className="fc-modal-sub-save" onClick={handleProfileBgModalSave} disabled={!profileBgUrlInput.trim()}>
                  {t('modal.apply')}
                </button>
                <button type="button" className="fc-modal-sub-cancel" onClick={() => { setShowProfileBgSubmodal(null); setProfileBgUrlInput(''); }}>
                  {t('modal.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Discard changes confirmation ── */}
      {pendingClose && (
        <ConfirmModal
          message={t('modal.discard_changes')}
          onConfirm={executeClose}
          onCancel={() => setPendingClose(false)}
        />
      )}
    </div>
  );
}
