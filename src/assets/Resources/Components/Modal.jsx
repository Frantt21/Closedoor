import React, { useEffect, useState } from 'react';
import './css/modal.css';
import '../Styles/explore.css';
import Badge from './Badge';
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

  useEffect(() => {
    setUsername(initialUsername || '');
    setBanner(initialBanner || '');
    setAvatar(initialAvatar || '');
    setBio(initialBio || '');
    setSocialLinks(Array.isArray(initialSocialLinks) ? initialSocialLinks : []);
    setSelectedAccent(initialAccentColor || '');
    setSelectedAccentSecondary(initialAccentColorSecondary || '');
    setInterests(Array.isArray(initialInterests) ? initialInterests : []);
    setInterestInput('');
    setNewSocial('');
    setSocialError('');
    setShowUrlModal(null);
    setUrlInput('');
    setHasChanges(false);
    setShowSuggested(false);
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
      JSON.stringify(interests) !== JSON.stringify(initialInterests || []) ||
      bannerPosition !== initialBannerPosition ||
      avatarPosition !== initialAvatarPosition;
    setHasChanges(changed);
  }, [
    username, banner, avatar, bio, socialLinks,    selectedAccent, selectedAccentSecondary, interests,
    bannerPosition, avatarPosition,
    initialUsername, initialBanner, initialAvatar, initialBio,
    initialSocialLinks,    initialAccentColor, initialAccentColorSecondary, initialInterests,
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
        interests: interests,
        banner_position: bannerPosition,
        avatar_position: avatarPosition,
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

  const defaultAvatar = 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';
  const previewUsername = username || 'username';

  const confirmClose = () => {
    if (hasChanges && !window.confirm(t('modal.discard_changes'))) return;
    onClose();
  };

  return (      <div className="fc-modal-overlay" role="dialog" aria-modal="true">
      <div className="fc-modal">
        {/* ── Two-column grid layout ── */}
        <div className="fc-modal-grid">
          {/* ── LEFT COLUMN ── */}
          <div className="fc-modal-grid-left">
            <h3 className="fc-modal-title" style={{ marginBottom: 20 }}>{t('modal.edit_title')}</h3>
            {/* ── Preview Card (grande) ── */}
            <div className="fc-preview-card fc-preview-card--large">
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
                <div className="fc-modal-sub" onClick={(e) => e.stopPropagation()}>
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

            {/* ── Accent Color — swatches + custom picker integrado ── */}
            <div className="fc-modal-section">
              <label className="fc-modal-label">{t('modal.accent_color')}</label>

              {/* Extracting / hint text (fuera del flex row) */}
              {banner.trim() && extracting && (
                <p className="fc-modal-social-hint">{t('modal.extracting_colors')}</p>
              )}
              {banner.trim() && !extracting && extractedColors.length < 4 && (
                <p className="fc-modal-social-hint">{t('modal.add_banner_hint')}</p>
              )}

              {/* Flex row: swatches + custom picker */}
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

                {/* Custom color picker inline en la misma fila */}
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

              {/* Reset button fuera del flex row */}
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

            {/* Bio */}
            <label className="fc-modal-label">
              {t('modal.bio_label')}
              <textarea
                className="fc-modal-input"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder={t('modal.bio_label')}
              />
            </label>

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

              {/* ── Detected platform preview (editable) ── */}
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

          {/* ── RIGHT COLUMN: Explore card preview + Interests ── */}
          <div className="fc-modal-grid-right">
            <h3 className="fc-modal-title" style={{ marginBottom: 20 }}>{t('modal.explore_preview')}</h3>
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
                </div>

                <div className="explore-card-action">
                  <button type="button" className="follow-btn follow-btn--follow" disabled>
                    {t('follow.follow')}
                  </button>
                </div>
              </div>
            </div>

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
          </div>
        </div>

        <div className="fc-modal-actions">
          <button className="fc-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? t('modal.saving') : t('modal.save')}
          </button>
          <button className="fc-modal-cancel" onClick={confirmClose} disabled={saving}>
            {t('modal.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
