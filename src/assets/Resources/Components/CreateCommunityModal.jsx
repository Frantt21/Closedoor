import { useEffect, useRef, useState } from 'react';
import ModalShell from './ModalShell';
import { useAuth } from '../../../hooks/useAuth';
import { useI18n } from '../../services/i18n/useI18n';
import { toast } from 'react-toastify';
import { FaCamera, FaSpinner, FaLock, FaGlobe } from 'react-icons/fa';
import { uploadWithLocalPreview } from '../../services/cdnService';
import { extractColors } from '../../services/colorExtractor';
import {
  createCommunity,
  canCreateCommunity,
  MIN_FOLLOWERS_TO_CREATE,
  isCommunitySlugAvailable,
  COMMUNITY_NAME_MAX,
  COMMUNITY_DESC_MAX,
} from '../../services/communityService';
import './css/modal.css';
import '../../Pages/styles/communities.css';

// Module-level cache igual que Modal.jsx (persiste entre aperturas)
const colorCache = {};

// Intereses sugeridos (los mismos que el modal de perfil)
const SUGGESTED_INTERESTS = [
  'Videojuegos', 'Películas', 'Música', 'Arte', 'Fotografía',
  'Deportes', 'Lectura', 'Escritura', 'Viajes', 'Cocina',
  'Tecnología', 'Ciencia', 'Naturaleza', 'Animales', 'Moda',
  'Diseño', 'Baile', 'Anime', 'Programación', 'IA',
  'Fitness', 'Fútbol', 'Historia', 'Astronomía', 'Emprendimiento',
  'Criptomonedas', 'Sostenibilidad', 'Streaming', 'Edición de Video', 'DIY',
];

export default function CreateCommunityModal({ isOpen, onClose, onSuccess }) {
  const { t } = useI18n();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [banner, setBanner] = useState('');
  const [description, setDescription] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [interests, setInterests] = useState([]);
  const [interestInput, setInterestInput] = useState('');
  const [showSuggested, setShowSuggested] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [accentColor, setAccentColor] = useState('');
  const [accentSecondary, setAccentSecondary] = useState('');
  const [extractedColors, setExtractedColors] = useState([]);
  const [extracting, setExtracting] = useState(false);

  const [slug, setSlug] = useState('');
  const [slugState, setSlugState] = useState('idle'); // idle | checking | available | taken
  const [followers, setFollowers] = useState(null);
  const [canCreate, setCanCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameTimerRef = useRef(null);

  // ── Reset al abrir ──
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setAvatar('');
    setBanner('');
    setDescription('');
    setRulesText('');
    setInterests([]);
    setInterestInput('');
    setShowSuggested(false);
    setIsPrivate(false);
    setAccentColor('');
    setAccentSecondary('');
    setExtractedColors([]);
    setSlug('');
    setSlugState('idle');
    setSaving(false);
  }, [isOpen]);

  // ── Chequear el mínimo de seguidores al abrir ──
  // (fallback defensivo: el botón de Comunidades.jsx ya lo valida antes de abrir)
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    canCreateCommunity(user.id).then((res) => {
      if (!cancelled) {
        setFollowers(res.followers);
        setCanCreate(res.allowed);
      }
    }).catch(() => {
      if (!cancelled) setFollowers(0);
    });
    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  // ── Validación de slug en vivo (debounce 400ms) ──
  useEffect(() => {
    if (!isOpen) return;
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current);

    const clean = name.trim();
    if (clean.length < 3) {
      setSlug('');
      setSlugState('idle');
      return;
    }
    setSlugState('checking');
    nameTimerRef.current = setTimeout(async () => {
      const { available, slug: s } = await isCommunitySlugAvailable(clean);
      setSlug(s);
      setSlugState(available ? 'available' : 'taken');
    }, 400);

    return () => {
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
    };
  }, [name, isOpen]);

  // ── Extraer colores del banner (debounce 400ms) ──
  useEffect(() => {
    const bannerUrl = banner.trim();
    if (!bannerUrl) {
      setExtractedColors([]);
      setExtracting(false);
      return;
    }
    if (colorCache[bannerUrl]) {
      setExtractedColors(colorCache[bannerUrl]);
      if (!accentColor) setAccentColor(colorCache[bannerUrl][0]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setExtracting(true);
        const colors = await extractColors(bannerUrl);
        if (banner.trim() === bannerUrl && colors.length >= 4) {
          setExtractedColors(colors);
          colorCache[bannerUrl] = colors;
          if (!accentColor) setAccentColor(colors[0]);
        }
      } catch {
        /* silencioso */
      } finally {
        setExtracting(false);
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner]);

  // ── Upload de imagen (avatar/banner) ──
  const handleFileUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('modal.invalid_image_type') || 'Invalid image type');
      return;
    }
    try {
      const { localUrl, realUrlPromise } = uploadWithLocalPreview(file, user.id, type === 'avatar' ? 'avatar' : 'banner');
      if (type === 'avatar') setAvatar(localUrl);
      else setBanner(localUrl);
      const realUrl = await realUrlPromise;
      if (type === 'avatar') setAvatar(realUrl);
      else setBanner(realUrl);
      toast.success(t('upload.uploaded') || 'Image uploaded', { autoClose: 2000 });
    } catch (err) {
      console.error('CDN upload error:', err);
      toast.error(err.message || 'Upload failed', { autoClose: 3000 });
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 3) {
      toast.error(t('comunidades.name_min'));
      return;
    }
    if (slugState === 'taken') {
      toast.error(t('comunidades.name_taken'));
      return;
    }
    if (!canCreate) {
      toast.error(t('comunidades.followers_required', { n: MIN_FOLLOWERS_TO_CREATE }));
      return;
    }

    const rules = rulesText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const community = await createCommunity({
        userId: user.id,
        name: cleanName,
        description,
        rules,
        interests,
        avatarUrl: avatar.trim() || null,
        bannerUrl: banner.trim() || null,
        accentColor: accentColor || null,
        accentColorSecondary: accentSecondary || null,
        isPrivate,
      });
      toast.success(t('comunidades.created'));
      if (onSuccess) onSuccess(community);
      onClose();
    } catch (err) {
      console.error('[Communities] Create error:', err);
      toast.error(err.message || t('comunidades.create_error'));
    } finally {
      setSaving(false);
    }
  };

  // Solo visible como fallback defensivo (el botón de la página ya bloquea
  // la apertura si no se cumplen los 100 seguidores).
  const needsFollowers = followers !== null && !canCreate;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} className="community-create-modal">
      {/* ── Header bar: title + actions ── */}
      <div className="fc-modal-header">
        <h3 className="fc-modal-title">{t('comunidades.create_community')}</h3>
        <div className="fc-modal-header-actions">
          <button className="fc-modal-save" onClick={handleSubmit} disabled={saving}>
            {saving ? <FaSpinner className="fc-spin" /> : t('comunidades.create_btn')}
          </button>
          <button type="button" className="fc-modal-close" onClick={onClose} aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sin max-height/overflow propios: el <dialog> nativo (fc-modal) ya
          scrollea con overflow-y:auto + max-height:90vh. Un scroll anidado
          aquí provocaba doble barra. padding-right reducido (4px) para dar
          respiro junto al scrollbar del dialog. */}
      <div className="community-create-body">
        {/* ── Aviso compacto del requisito de seguidores (fallback) ── */}
        {needsFollowers && (
          <div className="community-create-gate">
            <FaLock className="community-create-gate-icon" />
            <div className="community-create-gate-texts">
              <p className="community-create-gate-text">
                {t('comunidades.followers_required', { n: MIN_FOLLOWERS_TO_CREATE })}
              </p>
              <p className="community-create-gate-sub">
                {t('comunidades.followers_current', { n: followers || 0 })}
              </p>
            </div>
          </div>
        )}

        {/* ── Two-column grid (mismas clases que el modal de perfil Modal.jsx) ── */}
        <div className="fc-modal-grid">
          {/* ── LEFT COLUMN ── */}
          <div className="fc-modal-grid-left">
            {/* ── Preview ── */}
            <div
              className="community-create-preview"
              style={{
                '--cc-accent': accentColor || 'transparent',
                '--cc-accent-2': accentSecondary || accentColor || 'transparent',
              }}
            >
              <div className="community-create-preview-banner">
                {banner.trim() ? (
                  <img src={banner.trim()} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (
                  <div className="community-create-preview-banner-empty" />
                )}
                <button
                  type="button"
                  className="community-create-preview-banner-btn"
                  onClick={(e) => { e.stopPropagation(); document.getElementById('cc-banner-input')?.click(); }}
                  title={t('comunidades.banner')}
                >
                  <FaCamera />
                </button>
                <input
                  id="cc-banner-input"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileUpload(e, 'banner')}
                />
                <div className="community-create-preview-avatar-wrap">
                  <div className="community-create-preview-avatar">
                    {avatar.trim() ? (
                      <img src={avatar.trim()} alt="" onError={(e) => { e.target.src = ''; }} />
                    ) : (
                      <span className="community-create-preview-avatar-letter">
                        {(name.trim() || 'C').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="community-create-preview-avatar-btn"
                    onClick={() => document.getElementById('cc-avatar-input')?.click()}
                    title={t('comunidades.avatar')}
                  >
                    <FaCamera />
                  </button>
                  <input
                    id="cc-avatar-input"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileUpload(e, 'avatar')}
                  />
                </div>
              </div>
              <div className="community-create-preview-info">
                <span className="community-create-preview-name">{name.trim() || t('comunidades.name_placeholder')}</span>
                {slug && (
                  <span className="community-create-preview-slug">
                    c/{slug}
                    {slugState === 'available' && <span className="community-create-slug-ok">OK</span>}
                    {slugState === 'taken' && <span className="community-create-slug-bad">taken</span>}
                  </span>
                )}
                {isPrivate && <span className="community-create-preview-private"><FaLock /> {t('comunidades.private')}</span>}
              </div>
            </div>

            {/* ── Nombre ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">
                {t('comunidades.name')}
                <input
                  className="fc-modal-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('comunidades.name_placeholder')}
                  maxLength={COMMUNITY_NAME_MAX}
                />
                <span className="fc-modal-char-count">{name.length}/{COMMUNITY_NAME_MAX}</span>
              </label>
              {slugState === 'checking' && <p className="community-create-slug-status">{t('common.loading')}</p>}
              {slugState === 'taken' && <p className="community-create-slug-status community-create-slug-status--bad">{t('comunidades.name_taken')}</p>}
              {slugState === 'available' && <p className="community-create-slug-status community-create-slug-status--ok">{t('comunidades.name_available', { slug })}</p>}
            </div>

            {/* ── Descripción ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">
                {t('comunidades.description')}
                <textarea
                  className="fc-modal-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={COMMUNITY_DESC_MAX}
                  placeholder={t('comunidades.description_placeholder')}
                />
                <span className="fc-modal-char-count">{description.length}/{COMMUNITY_DESC_MAX}</span>
              </label>
            </div>

            {/* ── Reglas ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">
                {t('comunidades.rules')}
                <textarea
                  className="fc-modal-input"
                  value={rulesText}
                  onChange={(e) => setRulesText(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder={t('comunidades.rules_placeholder')}
                />
                <span className="fc-modal-input-hint">{t('comunidades.rules_hint')}</span>
              </label>
            </div>

            {/* ── Intereses ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">{t('comunidades.interests')}</label>
              <div className="fc-modal-interests-input-row">
                <input
                  className="fc-modal-input fc-modal-interests-input"
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = interestInput.trim();
                      if (val && !interests.includes(val)) setInterests((prev) => [...prev, val]);
                      setInterestInput('');
                    }
                  }}
                  placeholder={t('comunidades.interests_placeholder')}
                />
                <button
                  type="button"
                  className="fc-modal-interests-add"
                  onClick={() => {
                    const val = interestInput.trim();
                    if (val && !interests.includes(val)) setInterests((prev) => [...prev, val]);
                    setInterestInput('');
                  }}
                  disabled={!interestInput.trim()}
                >
                  +
                </button>
              </div>
              {interests.length > 0 && (
                <div className="fc-modal-interests-pills">
                  {interests.map((interest) => (
                    <span key={interest} className="fc-modal-interest-pill">
                      {interest}
                      <button
                        type="button"
                        className="fc-modal-interest-pill-remove"
                        onClick={() => setInterests((prev) => prev.filter((x) => x !== interest))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="fc-modal-suggested-wrapper">
                <button
                  type="button"
                  className="fc-modal-suggested-toggle"
                  onClick={() => setShowSuggested((prev) => !prev)}
                >
                  <span>{t('modal.suggested_interests')}</span>
                  <svg className={`fc-modal-suggested-chevron ${showSuggested ? 'fc-modal-suggested-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

          {/* ── RIGHT COLUMN ── */}
          <div className="fc-modal-grid-right">
            {/* ── Color acento ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">{t('comunidades.accent_color')}</label>
              {banner.trim() && extracting && <p className="fc-modal-social-hint">{t('modal.extracting_colors')}</p>}
              {banner.trim() && !extracting && extractedColors.length < 4 && (
                <p className="fc-modal-social-hint">{t('modal.add_banner_hint')}</p>
              )}
              <div className="fc-modal-color-picker">
                {banner.trim() && !extracting && extractedColors.length >= 4 && extractedColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`fc-modal-color-swatch ${accentColor === color ? 'fc-modal-color-swatch--selected' : ''}`}
                    style={{ '--swatch-color': color }}
                    onClick={() => setAccentColor(color)}
                    title={color}
                  >
                    {accentColor === color && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
                <label
                  htmlFor="community-accent-input"
                  className="fc-modal-color-swatch"
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: accentColor || '#000000',
                    border: '2px solid var(--color-border, #2a2a2a)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  title={`${t('modal.accent_color_custom')}: ${accentColor || '#000000'}`}
                >
                  <input
                    id="community-accent-input"
                    type="color"
                    value={accentColor || '#000000'}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </label>
              </div>
            </div>

            {/* ── Privacidad ── */}
            <div className="fc-modal-card">
              <label className="fc-modal-label">{t('comunidades.privacy')}</label>
              <div className="community-create-privacy-row">
                <button
                  type="button"
                  className={`community-create-privacy-opt ${!isPrivate ? 'community-create-privacy-opt--active' : ''}`}
                  onClick={() => setIsPrivate(false)}
                >
                  <FaGlobe className="community-create-privacy-icon" />
                  <span>
                    <strong>{t('comunidades.privacy_public')}</strong>
                    <small>{t('comunidades.privacy_public_hint')}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={`community-create-privacy-opt ${isPrivate ? 'community-create-privacy-opt--active' : ''}`}
                  onClick={() => setIsPrivate(true)}
                >
                  <FaLock className="community-create-privacy-icon" />
                  <span>
                    <strong>{t('comunidades.privacy_private')}</strong>
                    <small>{t('comunidades.privacy_private_hint')}</small>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
