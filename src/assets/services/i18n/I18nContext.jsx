import React, { createContext, useState, useEffect, useCallback } from 'react';
import es from './locales/es.json';

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
const SHOW_SAVES_KEY = 'fc_show_saves';
const HOUR24_KEY = 'fc_hour24';

const locales = { es };

// Cargar locale guardado o default español
function getSavedLocale() {
  try {
    return localStorage.getItem(LOCALE_KEY) || 'es';
  } catch {
    return 'es';
  }
}

function getSavedShowAccent() {
  try {
    const val = localStorage.getItem(ACCENT_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowAccentProfile() {
  try {
    const val = localStorage.getItem(ACCENT_PROFILE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowAccentExplore() {
  try {
    const val = localStorage.getItem(ACCENT_EXPLORE_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedAccentVisibility() {
  try {
    return localStorage.getItem(ACCENT_VISIBILITY_KEY) || 'both';
  } catch {
    return 'both';
  }
}

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

function getSavedShowInterests() {
  try {
    const val = localStorage.getItem(SHOW_INTERESTS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowTrending() {
  try {
    const val = localStorage.getItem(SHOW_TRENDING_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowProfileStats() {
  try {
    const val = localStorage.getItem(SHOW_PROFILE_STATS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

function getSavedShowToastNotifications() {
  try {
    const val = localStorage.getItem(SHOW_TOAST_NOTIFS_KEY);
    if (val !== null) return val === 'true';
    // Migración desde la antigua key fc_show_live_notifications
    const oldVal = localStorage.getItem('fc_show_live_notifications');
    const defaultVal = oldVal !== null ? oldVal === 'true' : true;
    localStorage.setItem(SHOW_TOAST_NOTIFS_KEY, String(defaultVal));
    return defaultVal;
  } catch { return true; }
}

function getSavedShowPushNotifications() {
  try {
    const val = localStorage.getItem(SHOW_PUSH_NOTIFS_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

function getSavedShowLikes() {
  try {
    const val = localStorage.getItem(SHOW_LIKES_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

function getSavedShowSaves() {
  try {
    const val = localStorage.getItem(SHOW_SAVES_KEY);
    return val === null ? false : val === 'true';
  } catch { return false; }
}

function getSavedHour24() {
  try {
    const val = localStorage.getItem(HOUR24_KEY);
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
  showSaves: false,
  setShowSaves: () => {},
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
  const [showSaves, setShowSavesState] = useState(getSavedShowSaves);
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
      localStorage.setItem(LOCALE_KEY, newLocale);
    } catch {}
  }, []);

  const setShowAccent = useCallback((value) => {
    setShowAccentState(value);
    try {
      localStorage.setItem(ACCENT_KEY, String(value));
    } catch {}
  }, []);

  const setShowAccentProfile = useCallback((value) => {
    setShowAccentProfileState(value);
    try {
      localStorage.setItem(ACCENT_PROFILE_KEY, String(value));
    } catch {}
  }, []);

  const setShowAccentExplore = useCallback((value) => {
    setShowAccentExploreState(value);
    try {
      localStorage.setItem(ACCENT_EXPLORE_KEY, String(value));
    } catch {}
  }, []);

  const setAccentVisibility = useCallback((value) => {
    setAccentVisibilityState(value);
    try {
      localStorage.setItem(ACCENT_VISIBILITY_KEY, value);
    } catch {}
  }, []);

  const setShowInterests = useCallback((value) => {
    setShowInterestsState(value);
    try {
      localStorage.setItem(SHOW_INTERESTS_KEY, String(value));
    } catch {}
  }, []);

  const setShowTrending = useCallback((value) => {
    setShowTrendingState(value);
    try {
      localStorage.setItem(SHOW_TRENDING_KEY, String(value));
    } catch {}
  }, []);

  const setShowProfileStats = useCallback((value) => {
    setShowProfileStatsState(value);
    try {
      localStorage.setItem(SHOW_PROFILE_STATS_KEY, String(value));
    } catch {}
  }, []);

  const setShowToastNotifications = useCallback((value) => {
    setShowToastNotificationsState(value);
    try {
      localStorage.setItem(SHOW_TOAST_NOTIFS_KEY, String(value));
    } catch {}
  }, []);

  const setShowPushNotifications = useCallback((value) => {
    setShowPushNotificationsState(value);
    try {
      localStorage.setItem(SHOW_PUSH_NOTIFS_KEY, String(value));
    } catch {}
  }, []);

  const setShowLikes = useCallback((value) => {
    setShowLikesState(value);
    try {
      localStorage.setItem(SHOW_LIKES_KEY, String(value));
    } catch {}
  }, []);

  const setShowSaves = useCallback((value) => {
    setShowSavesState(value);
    try {
      localStorage.setItem(SHOW_SAVES_KEY, String(value));
    } catch {}
  }, []);

  const setHour24 = useCallback((value) => {
    setHour24State(value);
    try {
      localStorage.setItem(HOUR24_KEY, String(value));
    } catch {}
  }, []);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_KEY, newTheme);
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
    <I18nContext.Provider      value={{ locale, t, setLocale, showAccent, setShowAccent, showAccentProfile, setShowAccentProfile, showAccentExplore, setShowAccentExplore, accentVisibility, setAccentVisibility, showInterests, setShowInterests, showTrending, setShowTrending, showProfileStats, setShowProfileStats, showToastNotifications, setShowToastNotifications, showPushNotifications, setShowPushNotifications, showLikes, setShowLikes, showSaves, setShowSaves, hour24, setHour24, theme, setTheme }}>
      {children}
    </I18nContext.Provider>
  );
}
