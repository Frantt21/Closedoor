import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import { useAuth } from '../../hooks/useAuth';
import { updateUserProfile } from '../services/userService';
import { FaGlobe, FaPalette, FaLock, FaChevronDown, FaChevronRight, FaCheck, FaSun, FaMoon, FaEyeSlash, FaCog, FaFeather, FaHeart, FaComment, FaRetweet, FaEye, FaUser, FaBookmark, FaTags, FaFire, FaChartBar } from 'react-icons/fa';
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
  { id: 'privacy', icon: FaEyeSlash, titleKey: 'settings.category_privacy', descKey: 'settings.category_privacy_desc' },
];

/* ── Main Settings Component ── */

export default function Settings() {
  const { locale, setLocale, showAccent, setShowAccent, showAccentProfile, setShowAccentProfile, showAccentExplore, setShowAccentExplore, accentVisibility, setAccentVisibility, showInterests, setShowInterests, showTrending, setShowTrending, showProfileStats, setShowProfileStats, theme, setTheme, t } = useI18n();
  usePageTitle(t('settings.title'));
  const { user, profile, profileLoading, refreshProfile } = useAuth();
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef(null);
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [statsPrivacyUpdating, setStatsPrivacyUpdating] = useState(false);
  const [activeCategory, setActiveCategory] = useState('system');
  const [accentExpanded, setAccentExpanded] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

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
      const allStats = { posts: true, likes: true, comments: true, reposts: true, views: true, profileViews: true, saves: true };
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

              {/* ── Colores de acento: toggle general + sub-opciones expandibles ── */}
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
              </div>

              {/* Expandir sub-opciones */}
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

              <div className="settings-row-divider" />

              {/* ── Perfil: visibilidad de cards ── */}
              <div className="settings-row">
                <div className="settings-row-header">
                  <span className="settings-section-icon"><FaEye /></span>
                  <div>
                    <h2 className="settings-section-title">{t('settings.profile_display')}</h2>
                    <p className="settings-section-desc">{t('settings.profile_display_desc')}</p>
                  </div>
                </div>
              </div>

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
                      const isVisible = statsVisibility == null ? !statsPrivate : statsVisibility[key] === true;
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
