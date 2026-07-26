import React, { createContext, useState, useEffect, useCallback } from 'react';
import es from './locales/es.json';
import { getItem, setItem } from '../secureStorage';

const LOCALE_KEY = 'fc_locale';
const ACCENT_KEY = 'fc_show_accent';
const THEME_KEY = 'fc_theme';
const ACCENT_PROFILE_KEY = 'fc_accent_profile';
const ACCENT_EXPLORE_KEY = 'fc_accent_explore';
const ACCENT_VISIBILITY_KEY = 'fc_accent_visibility';
const SHOW_INTERESTS_KEY = 'fc_show_interests';
const SHOW_TRENDING_KEY = 'fc_show_trending';
const SHOW_PROFILE_STATS_KEY = 'fc_show_profile_stats';
const SHOW_TOAST_NOTIFS_KEY = 'fc_show_toast_notifications';
const SHOW_PUSH_NOTIFS_KEY = 'fc_show_push_notifications';
const SHOW_LIKES_KEY = 'fc_show_likes';
const FILTER_ENCRYPTED_KEY = 'fc_filter_encrypted';
const ALLOW_MENTION_KEY = 'fc_allow_mention';
const ALLOW_ENCRYPTED_ADD_KEY = 'fc_allow_encrypted_add';
const HOUR24_KEY = 'fc_hour24';

const locales = { es };

// Mapeo de idiomas del navegador a locales disponibles
const BROWSER_LOCALE_MAP = {
  en: 'en',
  es: 'es',
  pt: 'pt',
  ru: 'ru',
  ja: 'ja',
};

/**
 * Detecta el idioma del navegador y lo mapea a un locale disponible.
 * Solo se usa si el usuario no ha guardado una preferencia explícita.
 */
function detectBrowserLocale() {
  try {
    const langs = navigator.languages || [navigator.language || navigator.userLanguage || ''];
    for (const full of langs) {
      const code = full.split('-')[0].toLowerCase();
      if (BROWSER_LOCALE_MAP[code]) {
        return BROWSER_LOCALE_MAP[code];
      }
    }
  } catch {}
  return 'es';
}

// Cargar locale guardado o auto-detectar del navegador
function getSavedLocale() {
  try {
    const saved = getItem(LOCALE_KEY);
    if (saved) return saved;
    return detectBrowserLocale();
  } catch {
    return detectBrowserLocale();
  }
}

function getSavedShowAccent() {
  try {
    const val = getItem(ACCENT_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowAccentProfile() {
  try {
    const val = getItem(ACCENT_PROFILE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowAccentExplore() {
  try {
    const val = getItem(ACCENT_EXPLORE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedAccentVisibility() {
  try {
    return getItem(ACCENT_VISIBILITY_KEY) || 'both';
  } catch {
    return 'both';
  }
}

function getSavedTheme() {
  try {
    return getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

function getSavedShowInterests() {
  try {
    const val = getItem(SHOW_INTERESTS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowTrending() {
  try {
    const val = getItem(SHOW_TRENDING_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowProfileStats() {
  try {
    const val = getItem(SHOW_PROFILE_STATS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowToastNotifications() {
  try {
    const val = getItem(SHOW_TOAST_NOTIFS_KEY);
    if (val !== null) return val === 'true';
    // Migración desde la antigua key fc_show_live_notifications
    const oldVal = getItem('fc_show_live_notifications');
    const defaultVal = oldVal !== null ? oldVal === 'true' : true;
    setItem(SHOW_TOAST_NOTIFS_KEY, String(defaultVal));
    return defaultVal;
  } catch { return true; }
}

function getSavedShowPushNotifications() {
  try {
    const val = getItem(SHOW_PUSH_NOTIFS_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

function getSavedShowLikes() {
  try {
    const val = getItem(SHOW_LIKES_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

function getSavedFilterEncrypted() {
  try {
    const val = getItem(FILTER_ENCRYPTED_KEY);
    return val === null ? true : val === 'true';
  } catch { return true; }
}

function getSavedAllowMention() {
  try {
    const val = getItem(ALLOW_MENTION_KEY);
    return val === null ? true : val === 'true';
  } catch { return true; }
}

function getSavedAllowEncryptedAdd() {
  try {
    // Si filterEncrypted está activo, allowEncryptedAdd siempre es false
    const filterVal = getItem(FILTER_ENCRYPTED_KEY);
    if (filterVal === null || filterVal === 'true') return false;
    const val = getItem(ALLOW_ENCRYPTED_ADD_KEY);
    return val === 'true';
  } catch { return false; }
}

function getSavedHour24() {
  try {
    const val = getItem(HOUR24_KEY);
    return val === null ? true : val === 'true';
  } catch { return true; }
}

export const I18nContext = createContext({
  locale: 'es',
  t: (key, params) => key,
  setLocale: () => {},
  showAccent: true,
  setShowAccent: () => {},
  showAccentProfile: true,
  setShowAccentProfile: () => {},
  showAccentExplore: true,
  setShowAccentExplore: () => {},
  accentVisibility: 'both',
  setAccentVisibility: () => {},
  showInterests: true,
  setShowInterests: () => {},
  showTrending: true,
  setShowTrending: () => {},
  showProfileStats: true,
  setShowProfileStats: () => {},
  showToastNotifications: true,
  setShowToastNotifications: () => {},
  showPushNotifications: false,
  setShowPushNotifications: () => {},
  showLikes: false,
  setShowLikes: () => {},
  filterEncrypted: true,
  setFilterEncrypted: () => {},
  allowMention: true,
  setAllowMention: () => {},
  allowEncryptedAdd: false,
  setAllowEncryptedAdd: () => {},
  hour24: true,
  setHour24: () => {},
  theme: 'dark',
  setTheme: () => {},
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getSavedLocale);
  const [translations, setTranslations] = useState(() => locales[getSavedLocale()] || es);
  const [showAccent, setShowAccentState] = useState(getSavedShowAccent);
  const [showAccentProfile, setShowAccentProfileState] = useState(getSavedShowAccentProfile);
  const [showAccentExplore, setShowAccentExploreState] = useState(getSavedShowAccentExplore);
  const [accentVisibility, setAccentVisibilityState] = useState(getSavedAccentVisibility);
  const [showInterests, setShowInterestsState] = useState(getSavedShowInterests);
  const [showTrending, setShowTrendingState] = useState(getSavedShowTrending);
  const [showProfileStats, setShowProfileStatsState] = useState(getSavedShowProfileStats);
  const [showToastNotifications, setShowToastNotificationsState] = useState(getSavedShowToastNotifications);
  const [showPushNotifications, setShowPushNotificationsState] = useState(getSavedShowPushNotifications);
  const [showLikes, setShowLikesState] = useState(getSavedShowLikes);
  const [filterEncrypted, setFilterEncryptedState] = useState(getSavedFilterEncrypted);
  const [allowMention, setAllowMentionState] = useState(getSavedAllowMention);
  const [allowEncryptedAdd, setAllowEncryptedAddState] = useState(getSavedAllowEncryptedAdd);
  const [hour24, setHour24State] = useState(getSavedHour24);
  const [theme, setThemeState] = useState(getSavedTheme);

  // Cargar el archivo de locale asíncrono
  useEffect(() => {
    if (locales[locale]) {
      setTranslations(locales[locale]);
      return;
    }
    import(`./locales/${locale}.json`)
      .then((mod) => {
        locales[locale] = mod.default || mod;
        setTranslations(locales[locale]);
      })
      .catch(() => {
        // Fallback a español
        setTranslations(es);
      });
  }, [locale]);

  const setLocale = useCallback((newLocale) => {
    setLocaleState(newLocale);
    try {
      setItem(LOCALE_KEY, newLocale);
    } catch {}
  }, []);

  const setShowAccent = useCallback((value) => {
    setShowAccentState(value);
    try {
      setItem(ACCENT_KEY, String(value));
    } catch {}
  }, []);

  const setShowAccentProfile = useCallback((value) => {
    setShowAccentProfileState(value);
    try {
      setItem(ACCENT_PROFILE_KEY, String(value));
    } catch {}
  }, []);

  const setShowAccentExplore = useCallback((value) => {
    setShowAccentExploreState(value);
    try {
      setItem(ACCENT_EXPLORE_KEY, String(value));
    } catch {}
  }, []);

  const setAccentVisibility = useCallback((value) => {
    setAccentVisibilityState(value);
    try {
      setItem(ACCENT_VISIBILITY_KEY, value);
    } catch {}
  }, []);

  const setShowInterests = useCallback((value) => {
    setShowInterestsState(value);
    try {
      setItem(SHOW_INTERESTS_KEY, String(value));
    } catch {}
  }, []);

  const setShowTrending = useCallback((value) => {
    setShowTrendingState(value);
    try {
      setItem(SHOW_TRENDING_KEY, String(value));
    } catch {}
  }, []);

  const setShowProfileStats = useCallback((value) => {
    setShowProfileStatsState(value);
    try {
      setItem(SHOW_PROFILE_STATS_KEY, String(value));
    } catch {}
  }, []);

  const setShowToastNotifications = useCallback((value) => {
    setShowToastNotificationsState(value);
    try {
      setItem(SHOW_TOAST_NOTIFS_KEY, String(value));
    } catch {}
  }, []);

  const setShowPushNotifications = useCallback((value) => {
    setShowPushNotificationsState(value);
    try {
      setItem(SHOW_PUSH_NOTIFS_KEY, String(value));
    } catch {}
  }, []);

  const setShowLikes = useCallback((value) => {
    setShowLikesState(value);
    try {
      setItem(SHOW_LIKES_KEY, String(value));
    } catch {}
  }, []);

  const setFilterEncrypted = useCallback((value) => {
    setFilterEncryptedState(value);
    try {
      setItem(FILTER_ENCRYPTED_KEY, String(value));
    } catch {}
  }, []);

  const setAllowMention = useCallback((value) => {
    setAllowMentionState(value);
    try {
      setItem(ALLOW_MENTION_KEY, String(value));
    } catch {}
  }, []);

  const setAllowEncryptedAdd = useCallback((value) => {
    setAllowEncryptedAddState(value);
    try {
      setItem(ALLOW_ENCRYPTED_ADD_KEY, String(value));
    } catch {}
  }, []);

  const setHour24 = useCallback((value) => {
    setHour24State(value);
    try {
      setItem(HOUR24_KEY, String(value));
    } catch {}
  }, []);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    try {
      setItem(THEME_KEY, newTheme);
    } catch {}
  }, []);

  // Aplicar tema al html element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const t = useCallback((key, params = {}) => {
    if (!translations) return key;
    let text = translations[key];
    if (text === undefined) return key;
    // Reemplazar parámetros {name}
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
    return text;
  }, [translations]);

  return (
    <I18nContext.Provider      value={{ locale, t, setLocale, showAccent, setShowAccent, showAccentProfile, setShowAccentProfile, showAccentExplore, setShowAccentExplore, accentVisibility, setAccentVisibility, showInterests, setShowInterests, showTrending, setShowTrending, showProfileStats, setShowProfileStats, showToastNotifications, setShowToastNotifications, showPushNotifications, setShowPushNotifications, showLikes, setShowLikes, filterEncrypted, setFilterEncrypted, allowMention, setAllowMention, allowEncryptedAdd, setAllowEncryptedAdd, hour24, setHour24, theme, setTheme }}>
      {children}
    </I18nContext.Provider>
  );
}
