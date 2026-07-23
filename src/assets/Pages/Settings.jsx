import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { useAuth } from '../../hooks/useAuth';
import { updateUserProfile } from '../services/userService';
import { clearAllAppCaches } from '../services/postService';
import { getBlockedUsers, getCachedBlockedUsers, unblockUser, cacheBlockStatus, subscribeBlockChanges } from '../services/blockService';
import { useNavigate } from 'react-router-dom';
import { FaGlobe, FaPalette, FaLock, FaChevronDown, FaChevronRight, FaCheck, FaSun, FaMoon, FaEyeSlash, FaCog, FaFeather, FaHeart, FaHeartBroken, FaComment, FaRetweet, FaEye, FaUser, FaBookmark, FaTags, FaFire, FaChartBar, FaBell, FaBrush, FaBan, FaClock, FaAt, FaTrashAlt, FaTimes } from 'react-icons/fa';
import { MdLogout } from 'react-icons/md';
import { toast } from 'react-toastify';
import ConfirmModal from '../Resources/Components/ConfirmModal';
import ModalShell from '../Resources/Components/ModalShell';
import '../Resources/Styles/settings.css';

/* ── SVG Flag Icons ── */

const FlagEs = () => (
  <svg viewBox="0 0 24 18" width="22" height="16" className="settings-flag">
    <rect width="24" height="18" fill="#c60b1e" />
    <rect y="3" width="24" height="12" fill="#ffc400" />
    <rect y="15" width="24" height="3" fill="#c60b1e" />
  </svg>
);

const FlagEn = () => (
  <svg viewBox="0 0 24 18" width="22" height="16" className="settings-flag">
    <rect width="24" height="18" fill="#012169" />
    <path d="M0 0 L24 18 M24 0 L0 18" stroke="#fff" strokeWidth="3.5" />
    <path d="M0 0 L24 18 M24 0 L0 18" stroke="#c8102e" strokeWidth="1.5" />
    <rect x="10" y="0" width="4" height="18" fill="#fff" />
    <rect x="10" y="0" width="4" height="18" fill="#c8102e" strokeWidth="1.5" />
    <rect x="0" y="6" width="24" height="6" fill="#fff" />
    <rect x="0" y="6" width="24" height="6" fill="#c8102e" strokeWidth="1.5" />
  </svg>
);

const FlagRu = () => (
  <svg viewBox="0 0 24 18" width="22" height="16" className="settings-flag">
    <rect width="24" height="18" fill="#fff" />
    <rect y="6" width="24" height="6" fill="#0039a6" />
    <rect y="12" width="24" height="6" fill="#d52b1e" />
  </svg>
);

const FlagJa = () => (
  <svg viewBox="0 0 24 18" width="22" height="16" className="settings-flag">
    <rect width="24" height="18" fill="#fff" rx="1" />
    <circle cx="12" cy="9" r="5" fill="#bc002d" />
  </svg>
);

const FlagPt = () => (
  <svg viewBox="0 0 24 18" width="22" height="16" className="settings-flag">
    <rect width="9.6" height="18" fill="#006600" />
    <rect x="9.6" width="14.4" height="18" fill="#ff0000" />
    <circle cx="9.6" cy="9" r="3.2" fill="#ffcc00" />
    <circle cx="9.6" cy="9" r="1.5" fill="#006600" />
  </svg>
);

const LANGUAGES = [
  { value: 'es', Flag: FlagEs },
  { value: 'en', Flag: FlagEn },
  { value: 'ru', Flag: FlagRu },
  { value: 'ja', Flag: FlagJa },
  { value: 'pt', Flag: FlagPt },
];

const CATEGORIES = [
  { id: 'system', icon: FaCog, titleKey: 'settings.category_system', descKey: 'settings.category_system_desc' },
  { id: 'profile', icon: FaUser, titleKey: 'settings.category_profile', descKey: 'settings.category_profile_desc' },
  { id: 'privacy', icon: FaEyeSlash, titleKey: 'settings.category_privacy', descKey: 'settings.category_privacy_desc' },
  { id: 'notifications', icon: FaBell, titleKey: 'settings.category_notifications', descKey: 'settings.category_notifications_desc' },
];

/* ── Main Settings Component ── */

export default function Settings() {
  const { locale, setLocale, showAccent, setShowAccent, showAccentProfile, setShowAccentProfile, showAccentExplore, setShowAccentExplore, accentVisibility, setAccentVisibility, showInterests, setShowInterests, showTrending, setShowTrending, showProfileStats, setShowProfileStats, showToastNotifications, setShowToastNotifications, showPushNotifications, setShowPushNotifications, showLikes, setShowLikes, filterEncrypted, setFilterEncrypted, allowMention, setAllowMention, allowEncryptedAdd, setAllowEncryptedAdd, hour24, setHour24, theme, setTheme, t } = useI18n();
  usePageTitle(t('settings.title'));
  const { user, profile, profileLoading, refreshProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef(null);
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [statsPrivacyUpdating, setStatsPrivacyUpdating] = useState(false);
  const [activeCategory, setActiveCategory] = useState('system');
  const [accentExpanded, setAccentExpanded] = useState(false);
  const [cardsExpanded, setCardsExpanded] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState(() => {
    if (!user?.id) return [];
    return getCachedBlockedUsers(user.id) || [];
  });
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(() => {
    return !user?.id || !getCachedBlockedUsers(user.id);
  });
  const [unblockingId, setUnblockingId] = useState(null);
  const [showClearCacheModal, setShowClearCacheModal] = useState(false);
  const [cacheRevision, setCacheRevision] = useState(0);

  // ── Calculate cache size ──
  const cacheSize = useMemo(() => {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fc_')) {
          const value = localStorage.getItem(key);
          if (value) total += value.length * 2; // UTF-16: 2 bytes per char
        }
      }
      if (total === 0) return '0 KB';
      if (total < 1024) return `${total} B`;
      if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`;
      return `${(total / (1024 * 1024)).toFixed(1)} MB`;
    } catch {
      return '0 KB';
    }
  }, [cacheRevision]);

  const handleClearCache = () => {
    clearAllAppCaches();
    setCacheRevision(v => v + 1);
    setShowClearCacheModal(false);
    toast.success(t('settings.cache_cleared'));
  };

  // ── Forzar re-render cuando cambia el estado de bloqueo (subscribeBlockChanges) ──
  const [blockRevision, setBlockRevision] = useState(0);
  useEffect(() => {
    return subscribeBlockChanges(() => setBlockRevision(v => v + 1));
  }, []);

  // ── Cargar usuarios bloqueados al abrir el modal (siempre refresca en background) ──
  useEffect(() => {
    if (!showBlockedModal || !user?.id) return;
    getBlockedUsers(user.id)
      .then((data) => {
        setBlockedUsers(data);
        setBlockedUsersLoading(false);
      })
      .catch((err) => {
        console.warn('Error loading blocked users:', err);
        setBlockedUsersLoading(false);
      });
  }, [showBlockedModal, user?.id, blockRevision]);

  const handleUnblock = async (blockedId) => {
    if (!user?.id || unblockingId) return;
    setUnblockingId(blockedId);
    try {
      await unblockUser(user.id, blockedId);
      cacheBlockStatus(user.id, blockedId, false);
      setBlockedUsers((prev) => prev.filter((u) => u.id !== blockedId));
    } catch (err) {
      console.error('Error unblocking user:', err);
    } finally {
      setUnblockingId(null);
    }
  };

  const isPrivate = profile?.is_private ?? false;
  const statsPrivate = profile?.stats_private ?? false;
  // No usar || {} para poder distinguir null (legacy) de {} (explicitamente vacío)
  const statsVisibility = profile?.stats_visibility;

  // ── Sincronizar preferencias con Supabase ──
  const [savingPref, setSavingPref] = useState(false);

  const syncProfilePref = async (key, value) => {
    if (!user?.id || savingPref) return;
    setSavingPref(true);
    try {
      await updateUserProfile(user.id, { [key]: value });
      await refreshProfile(user.id);
    } catch (err) {
      console.error('Error syncing profile pref:', err);
    } finally {
      setSavingPref(false);
    }
  };

  const handlePrivacyChange = async (value) => {
    if (!user?.id || privacyUpdating || value === isPrivate) return;
    setPrivacyUpdating(true);
    try {
      await updateUserProfile(user.id, { is_private: value });
      await refreshProfile(user.id);
    } catch (err) {
      console.error('Error updating privacy:', err);
    } finally {
      setPrivacyUpdating(false);
    }
  };

  const handleStatsPrivacyChange = async (value) => {
    if (!user?.id || statsPrivacyUpdating || value === statsPrivate) return;
    setStatsPrivacyUpdating(true);
    try {
      // El toggle general sincroniza todas las stats individuales:
      // Public (false) → todas visibles, Private (true) → todas ocultas
      const allStats = { posts: true, likes: true, dislikes: true, comments: true, reposts: true, views: true, profileViews: true, saves: true };
      const newVisibility = value ? {} : allStats; // {} = todas ocultas, allStats = todas visibles
      await updateUserProfile(user.id, {
        stats_private: value,
        stats_visibility: newVisibility,
      });
      await refreshProfile(user.id);
    } catch (err) {
      console.error('Error updating stats privacy:', err);
    } finally {
      setStatsPrivacyUpdating(false);
    }
  };

  // ── Stats individuales: iconos y keys ──
  const STAT_ITEMS = [
    { key: 'posts', icon: FaFeather, labelKey: 'profile.posts_tab' },
    { key: 'likes', icon: FaHeart, labelKey: 'profile.stats_likes' },
    { key: 'dislikes', icon: FaHeartBroken, labelKey: 'profile.stats_dislikes' },
    { key: 'comments', icon: FaComment, labelKey: 'profile.stats_comments' },
    { key: 'reposts', icon: FaRetweet, labelKey: 'profile.stats_reposts' },
    { key: 'views', icon: FaEye, labelKey: 'profile.stats_views' },
    { key: 'profileViews', icon: FaUser, labelKey: 'profile.stats_profile_views' },
    { key: 'saves', icon: FaBookmark, labelKey: 'profile.stats_saved' },
  ];

  const handleStatVisibilityChange = async (statKey, visible) => {
    if (!user?.id) return;
    const newVisibility = { ...(profile?.stats_visibility || {}), [statKey]: visible };
    try {
      await updateUserProfile(user.id, { stats_visibility: newVisibility });
      await refreshProfile(user.id);
    } catch (err) {
      console.error('Error updating stat visibility:', err);
    }
  };

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    if (!selectOpen) return;
    const handleClick = (e) => {
      if (selectRef.current && !selectRef.current.contains(e.target)) {
        setSelectOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectOpen]);

  const currentLang = LANGUAGES.find((l) => l.value === locale) || LANGUAGES[0];
  const CurrentFlag = currentLang.Flag;

  return (
    <div className="settings-page">
      <div className="settings-card settings-card--split">
        {/* ── Left Panel: Category Navigation ── */}
        <nav className="settings-nav">
          {CATEGORIES.map(({ id, icon: Icon, titleKey, descKey }) => (
            <button
              key={id}
              type="button"
              className={`settings-nav-btn ${activeCategory === id ? 'settings-nav-btn--active' : ''}`}
              onClick={() => {
                setSelectOpen(false);
                setActiveCategory(id);
              }}
            >
              <span className="settings-nav-icon"><Icon /></span>
              <div className="settings-nav-info">
                <span className="settings-nav-title">{t(titleKey)}</span>
                <span className="settings-nav-desc">{t(descKey)}</span>
              </div>
            </button>
          ))}
        </nav>

        {/* ── Right Panel: Active Category Content ── */}
        <div className="settings-panel">
          {activeCategory === 'system' && (
            <>
              {/* ── Apariencia ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaBrush /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.appearance')}</h2>
                    <p className="settings-section-desc">{t('settings.appearance_desc')}</p>
                  </div>
                </div>
              </div>

              {/* Idioma */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaGlobe /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.language')}</h2>
                    <p className="settings-section-desc">{t('settings.language_desc')}</p>
                  </div>
                </div>

                <div className="settings-select-wrapper" ref={selectRef}>
                  <button
                    type="button"
                    className="settings-select-trigger"
                    onClick={() => setSelectOpen((s) => !s)}
                  >
                    <CurrentFlag />
                    <span className="settings-select-label">{t(`settings.${locale}`)}</span>
                    <FaChevronDown className={`settings-select-arrow ${selectOpen ? 'settings-select-arrow--open' : ''}`} />
                  </button>

                  {selectOpen && (
                    <div className="settings-select-dropdown">
                      {LANGUAGES.map(({ value, Flag }) => (
                        <button
                          key={value}
                          type="button"
                          className={`settings-select-option ${value === locale ? 'settings-select-option--active' : ''}`}
                          onClick={() => {
                            setLocale(value);
                            setSelectOpen(false);
                          }}
                        >
                          <Flag />
                          <span>{t(`settings.${value}`)}</span>
                          {value === locale && <FaCheck className="settings-select-check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Formato de hora */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaClock /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.time_format')}</h2>
                    <p className="settings-section-desc">{t('settings.time_format_desc')}</p>
                  </div>
                </div>
                <div className="settings-segmented">
                  <button
                    type="button"
                    className={`settings-segmented-btn ${hour24 ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => setHour24(true)}
                  >
                    {t('settings.time_format_24h')}
                  </button>
                  <button
                    type="button"
                    className={`settings-segmented-btn ${!hour24 ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => setHour24(false)}
                  >
                    {t('settings.time_format_12h')}
                  </button>
                </div>
              </div>

              <div className="settings-row-divider" />

              {/* Tema */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon">{theme === 'light' ? <FaSun /> : <FaMoon />}</span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.theme')}</h2>
                    <p className="settings-section-desc">{t('settings.theme_desc')}</p>
                  </div>
                </div>
                <div className="settings-segmented">
                  <button
                    type="button"
                    className={`settings-segmented-btn ${theme === 'dark' ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    <FaMoon style={{ marginRight: 6 }} />{t('settings.theme_dark')}
                  </button>
                  <button
                    type="button"
                    className={`settings-segmented-btn ${theme === 'light' ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    <FaSun style={{ marginRight: 6 }} />{t('settings.theme_light')}
                  </button>
                </div>
              </div>

              <div className="settings-row-divider" />

              {/* ── Caché ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaTrashAlt /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.cache')}</h2>
                    <p className="settings-section-desc">{t('settings.cache_desc')}</p>
                  </div>
                </div>
                <span className="settings-cache-size">{t('settings.cache_size', { size: cacheSize })}</span>
                <button
                  type="button"
                  className="settings-edit-btn"
                  onClick={() => setShowClearCacheModal(true)}
                >
                  <FaTrashAlt style={{ marginRight: 6 }} />
                  {t('settings.cache_clear')}
                </button>
              </div>

              <div className="settings-row-divider" />

              {/* ── Cerrar sesión ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><MdLogout /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.logout')}</h2>
                    <p className="settings-section-desc">{t('settings.logout_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-danger-btn"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  <MdLogout style={{ marginRight: 6 }} />
                  {t('settings.logout_btn')}
                </button>
              </div>
            </>
          )}

          {activeCategory === 'profile' && (
            <>
              {/* ── Colores de acento ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaPalette /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.show_accent')}</h2>
                    <p className="settings-section-desc">{t('settings.show_accent_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${showAccent ? 'settings-toggle--active' : ''}`}
                  onClick={() => setShowAccent(!showAccent)}
                  aria-pressed={showAccent}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>

                {/* Expandir sub-opciones de acento */}
                <button
                  type="button"
                  className="settings-stats-expand-btn"
                  onClick={() => setAccentExpanded((s) => !s)}
                >
                  <span className={`settings-stats-expand-arrow ${accentExpanded ? 'settings-stats-expand-arrow--open' : ''}`}>
                    <FaChevronRight />
                  </span>
                  <span>{accentExpanded ? t('settings.accent_hide_details') : t('settings.accent_show_details')}</span>
                </button>

                {accentExpanded && (
                  <div className="settings-accent-list">
                    {/* Mostrar en el perfil */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaPalette /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.show_accent_profile')}</h2>
                          <p className="settings-section-desc">{t('settings.show_accent_profile_desc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${showAccentProfile ? 'settings-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !showAccentProfile;
                          setShowAccentProfile(next);
                          syncProfilePref('show_accent_profile', next);
                        }}
                        aria-pressed={showAccentProfile}
                      >
                        <span className="settings-toggle-track">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    {/* Mostrar en Explore */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaPalette /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.show_accent_explore')}</h2>
                          <p className="settings-section-desc">{t('settings.show_accent_explore_desc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${showAccentExplore ? 'settings-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !showAccentExplore;
                          setShowAccentExplore(next);
                          syncProfilePref('show_accent_explore', next);
                        }}
                        aria-pressed={showAccentExplore}
                      >
                        <span className="settings-toggle-track">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    {/* Visibilidad del color acento */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaPalette /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.accent_visibility')}</h2>
                          <p className="settings-section-desc">{t('settings.accent_visibility_desc')}</p>
                        </div>
                      </div>
                      <div className="settings-segmented">
                        <button
                          type="button"
                          className={`settings-segmented-btn ${accentVisibility === 'others' ? 'settings-segmented-btn--active' : ''}`}
                          onClick={() => {
                            setAccentVisibility('others');
                            syncProfilePref('accent_visibility', 'others');
                          }}
                        >
                          {t('settings.accent_visibility_others')}
                        </button>
                        <button
                          type="button"
                          className={`settings-segmented-btn ${accentVisibility === 'both' ? 'settings-segmented-btn--active' : ''}`}
                          onClick={() => {
                            setAccentVisibility('both');
                            syncProfilePref('accent_visibility', 'both');
                          }}
                        >
                          {t('settings.accent_visibility_both')}
                        </button>
                        <button
                          type="button"
                          className={`settings-segmented-btn ${accentVisibility === 'me' ? 'settings-segmented-btn--active' : ''}`}
                          onClick={() => {
                            setAccentVisibility('me');
                            syncProfilePref('accent_visibility', 'me');
                          }}
                        >
                          {t('settings.accent_visibility_me')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="settings-row-divider" />

              {/* ── Visibilidad de cards ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaEye /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.profile_display')}</h2>
                    <p className="settings-section-desc">{t('settings.profile_display_desc')}</p>
                  </div>
                </div>

                {/* Expandir sub-opciones de cards */}
                <button
                  type="button"
                  className="settings-stats-expand-btn"
                  onClick={() => setCardsExpanded((s) => !s)}
                >
                  <span className={`settings-stats-expand-arrow ${cardsExpanded ? 'settings-stats-expand-arrow--open' : ''}`}>
                    <FaChevronRight />
                  </span>
                  <span>{cardsExpanded ? t('settings.cards_hide_details') : t('settings.cards_show_details')}</span>
                </button>

                {cardsExpanded && (
                  <div className="settings-accent-list">
                    {/* Mostrar intereses */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaTags /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.show_interests')}</h2>
                          <p className="settings-section-desc">{t('settings.show_interests_desc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${showInterests ? 'settings-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !showInterests;
                          setShowInterests(next);
                          syncProfilePref('show_interests', next);
                        }}
                        aria-pressed={showInterests}
                      >
                        <span className="settings-toggle-track">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    {/* Mostrar estadísticas */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaChartBar /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.show_stats_card')}</h2>
                          <p className="settings-section-desc">{t('settings.show_stats_card_desc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${showProfileStats ? 'settings-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !showProfileStats;
                          setShowProfileStats(next);
                          syncProfilePref('show_profile_stats', next);
                        }}
                        aria-pressed={showProfileStats}
                      >
                        <span className="settings-toggle-track">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    {/* Mostrar tendencias */}
                    <div className="settings-row">
                      <div className="settings-row-header">
                        <span className="settings-section-icon"><FaFire /></span>
                        <div>
                          <h2 className="settings-section-title">{t('settings.show_trending')}</h2>
                          <p className="settings-section-desc">{t('settings.show_trending_desc')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-toggle ${showTrending ? 'settings-toggle--active' : ''}`}
                        onClick={() => {
                          const next = !showTrending;
                          setShowTrending(next);
                          syncProfilePref('show_trending', next);
                        }}
                        aria-pressed={showTrending}
                      >
                        <span className="settings-toggle-track">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {activeCategory === 'notifications' && (
            <>
              {/* ── Notificaciones ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaBell /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.notifications')}</h2>
                    <p className="settings-section-desc">{t('settings.notifications_desc')}</p>
                  </div>
                </div>
              </div>

              {/* Notificaciones toast */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaBell /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.show_toast_notifications')}</h2>
                    <p className="settings-section-desc">{t('settings.show_toast_notifications_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${showToastNotifications ? 'settings-toggle--active' : ''}`}
                  onClick={() => setShowToastNotifications(!showToastNotifications)}
                  aria-pressed={showToastNotifications}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>

              {/* Notificaciones push */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaBell /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.show_push_notifications')}</h2>
                    <p className="settings-section-desc">{t('settings.show_push_notifications_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${showPushNotifications ? 'settings-toggle--active' : ''}`}
                  onClick={() => {
                    const next = !showPushNotifications;
                    setShowPushNotifications(next);
                    // Si se activa push, pedir permiso al navegador
                    if (next && 'Notification' in window && Notification.permission === 'default') {
                      Notification.requestPermission();
                    }
                  }}
                  aria-pressed={showPushNotifications}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>
            </>
          )}

          {activeCategory === 'privacy' && (
            <>
              {/* Configuración de perfil */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaLock /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.profile_config')}</h2>
                    <p className="settings-section-desc">{t('settings.profile_config_desc')}</p>
                  </div>
                </div>

                <div className="settings-segmented">
                  <button
                    type="button"
                    className={`settings-segmented-btn ${!isPrivate ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => handlePrivacyChange(false)}
                    disabled={privacyUpdating || profileLoading}
                  >
                    {t('settings.public_profile')}
                  </button>
                  <button
                    type="button"
                    className={`settings-segmented-btn ${isPrivate ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => handlePrivacyChange(true)}
                    disabled={privacyUpdating || profileLoading}
                  >
                    {t('settings.private_profile')}
                  </button>
                </div>
              </div>

              <div className="settings-row-divider" />

              {/* Privacidad de estadísticas */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaEyeSlash /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.stats_privacy')}</h2>
                    <p className="settings-section-desc">{t('settings.stats_privacy_desc')}</p>
                  </div>
                </div>

                <div className="settings-segmented">
                  <button
                    type="button"
                    className={`settings-segmented-btn ${!statsPrivate ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => handleStatsPrivacyChange(false)}
                    disabled={statsPrivacyUpdating || profileLoading}
                  >
                    {t('settings.stats_public')}
                  </button>
                  <button
                    type="button"
                    className={`settings-segmented-btn ${statsPrivate ? 'settings-segmented-btn--active' : ''}`}
                    onClick={() => handleStatsPrivacyChange(true)}
                    disabled={statsPrivacyUpdating || profileLoading}
                  >
                    {t('settings.stats_private')}
                  </button>
                </div>

                {/* ── Expandir stats individuales ── */}
                <button
                  type="button"
                  className="settings-stats-expand-btn"
                  onClick={() => setStatsExpanded((s) => !s)}
                >
                  <span className={`settings-stats-expand-arrow ${statsExpanded ? 'settings-stats-expand-arrow--open' : ''}`}>
                    <FaChevronRight />
                  </span>
                  <span>{statsExpanded ? t('settings.stats_hide_individual') : t('settings.stats_show_individual')}</span>
                </button>

                {statsExpanded && (
                  <div className="settings-stats-list">
                    {STAT_ITEMS.map(({ key, icon: Icon, labelKey }) => {
                      // null = legacy: mostrar según statsPrivate
                      // {} = todas ocultas (seteado por toggle general Privado)
                      // {likes: true} = solo likes visibles
                      // undefined = stat agregada después, visible por defecto
                      const isVisible = statsVisibility == null ? !statsPrivate : statsVisibility[key] !== false;
                      return (
                        <label key={key} className="settings-stat-toggle">
                          <span className="settings-stat-toggle-label">
                            <Icon className="settings-stat-toggle-icon" />
                            {t(labelKey)}
                          </span>
                          <span className="settings-toggle">
                            <input
                              type="checkbox"
                              checked={isVisible}
                              onChange={() => handleStatVisibilityChange(key, !isVisible)}
                            />
                            <span className="settings-toggle-track">
                              <span className="settings-toggle-thumb" />
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="settings-row-divider" />

              {/* ── Privacidad de likes ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaHeart /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.show_likes')}</h2>
                    <p className="settings-section-desc">{t('settings.show_likes_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${showLikes ? 'settings-toggle--active' : ''}`}
                  onClick={() => {
                    const next = !showLikes;
                    setShowLikes(next);
                    syncProfilePref('show_likes', next);
                  }}
                  aria-pressed={showLikes}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>

              <div className="settings-row-divider" />

              {/* ── Permisos de interacción ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaAt /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.allow_mention')}</h2>
                    <p className="settings-section-desc">{t('settings.allow_mention_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${allowMention ? 'settings-toggle--active' : ''}`}
                  onClick={() => {
                    const next = !allowMention;
                    setAllowMention(next);
                    syncProfilePref('allow_mention', next);
                  }}
                  aria-pressed={allowMention}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>

              <div className="settings-row-divider" />

              {/* ── Filtrar posts encriptados ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaEyeSlash /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.filter_encrypted')}</h2>
                    <p className="settings-section-desc">{t('settings.filter_encrypted_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${filterEncrypted ? 'settings-toggle--active' : ''}`}
                  onClick={() => {
                    const next = !filterEncrypted;
                    setFilterEncrypted(next);
                    // Si filterEncrypted se activa, desactivar allowEncryptedAdd
                    if (next) {
                      setAllowEncryptedAdd(false);
                      syncProfilePref('allow_encrypted_add', false);
                    }
                  }}
                  aria-pressed={filterEncrypted}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>

              <div className="settings-row-divider" />

              {/* ── Permitir inclusión en posts encriptados ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaEyeSlash /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.allow_encrypted_add')}</h2>
                    <p className="settings-section-desc">{t('settings.allow_encrypted_add_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`settings-toggle ${allowEncryptedAdd ? 'settings-toggle--active' : ''}`}
                  onClick={() => {
                    if (filterEncrypted) return;
                    const next = !allowEncryptedAdd;
                    setAllowEncryptedAdd(next);
                    syncProfilePref('allow_encrypted_add', next);
                  }}
                  aria-pressed={allowEncryptedAdd}
                  disabled={filterEncrypted}
                  style={filterEncrypted ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                </button>
              </div>

              <div className="settings-row-divider" />

              {/* ── Usuarios bloqueados ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaBan /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.blocked_users')}</h2>
                    <p className="settings-section-desc">{t('settings.blocked_users_desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-edit-btn"
                  onClick={() => setShowBlockedModal(true)}
                >
                  <FaBan style={{ marginRight: 6 }} />
                  {t('settings.blocked_users')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Clear Cache Confirmation ── */}
      {showClearCacheModal && (
        <ConfirmModal
          message={t('settings.cache_clear_confirm')}
          onConfirm={handleClearCache}
          onCancel={() => setShowClearCacheModal(false)}
        />
      )}

      {/* ── Blocked Users Modal ── */}
      <ModalShell
        isOpen={showBlockedModal}
        onClose={() => setShowBlockedModal(false)}
        onEscape={() => setShowBlockedModal(false)}
        disableBackdropClose={false}
        className="settings-blocked-modal"
      >
        <div className="followers-modal-header">
          <h3 className="fc-modal-title">{t('settings.blocked_users')}</h3>
          <button
            type="button"
            className="followers-modal-close"
            onClick={() => setShowBlockedModal(false)}
            aria-label={t('common.close')}
          >
            <FaTimes />
          </button>
        </div>
        <div className="settings-blocked-list">
          {blockedUsersLoading ? (
            <div className="settings-blocked-loading">{t('common.loading')}</div>
          ) : blockedUsers.length === 0 ? (
            <div className="settings-blocked-empty">
              <FaBan className="settings-blocked-empty-icon" />
              <p>{t('block.no_blocked_users')}</p>
            </div>
          ) : (
            blockedUsers.map((u) => (
              <div key={u.id} className="settings-blocked-item">
                <img
                  className="settings-blocked-avatar"
                  src={u.avatar_url || 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg'}
                  alt={u.username}
                />
                <div className="settings-blocked-info">
                  <span className="settings-blocked-username">@{u.username}</span>
                </div>
                <button
                  type="button"
                  className="settings-blocked-unblock-btn"
                  onClick={() => handleUnblock(u.id)}
                  disabled={unblockingId === u.id}
                >
                  {unblockingId === u.id ? '...' : t('block.unblock')}
                </button>
              </div>
            ))
          )}
        </div>
      </ModalShell>
    </div>
  );
}
