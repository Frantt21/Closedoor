import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../services/i18n/useI18n';
import { useAuth } from '../../hooks/useAuth';
import { updateUserProfile } from '../services/userService';
import { FaGlobe, FaPalette, FaLock, FaChevronDown, FaCheck, FaSun, FaMoon } from 'react-icons/fa';
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
    <rect width="24" height="6" fill="#fff" />
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

export default function Settings() {
  const { locale, setLocale, showAccent, setShowAccent, theme, setTheme, t } = useI18n();
  const { user, profile, profileLoading, refreshProfile } = useAuth();
  const [selectOpen, setSelectOpen] = useState(false);
  const selectRef = useRef(null);
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [statsPrivacyUpdating, setStatsPrivacyUpdating] = useState(false);

  const isPrivate = profile?.is_private ?? false;
  const statsPrivate = profile?.stats_private ?? false;

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
      await updateUserProfile(user.id, { stats_private: value });
      await refreshProfile(user.id);
    } catch (err) {
      console.error('Error updating stats privacy:', err);
    } finally {
      setStatsPrivacyUpdating(false);
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
      <h1 className="settings-title">{t('settings.title')}</h1>

      <div className="settings-card">
        {/* ── Idioma ── */}
        <div className="settings-section">
          <div className="settings-section-header">
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

        {/* ── Separador ── */}
        <div className="settings-divider" />

        {/* ── Configuración de perfil ── */}
        <div className="settings-section">
          <div className="settings-section-header">
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

        {/* ── Separador ── */}
        <div className="settings-divider" />

        {/* ── Privacidad de estadísticas ── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-icon"><FaLock /></span>
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
        </div>

        {/* ── Separador ── */}
        <div className="settings-divider" />

        {/* ── Tema ── */}
        <div className="settings-section">
          <div className="settings-section-header">
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

        {/* ── Separador ── */}
        <div className="settings-divider" />

        {/* ── Colores de acento ── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <span className="settings-section-icon"><FaPalette /></span>
            <div>
              <h2 className="settings-section-title">{t('settings.show_accent')}</h2>
              <p className="settings-section-desc">{t('settings.show_accent_desc')}</p>
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showAccent}
              onChange={(e) => setShowAccent(e.target.checked)}
            />
            <span className="settings-toggle-track">
              <span className="settings-toggle-thumb" />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
