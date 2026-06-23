import React, { createContext, useState, useEffect, useCallback } from 'react';
import es from './locales/es.json';

const LOCALE_KEY = 'fc_locale';
const ACCENT_KEY = 'fc_show_accent';
const THEME_KEY = 'fc_theme';
const ACCENT_PROFILE_KEY = 'fc_accent_profile';
const ACCENT_EXPLORE_KEY = 'fc_accent_explore';
const ACCENT_VISIBILITY_KEY = 'fc_accent_visibility';

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
    <I18nContext.Provider value={{ locale, t, setLocale, showAccent, setShowAccent, showAccentProfile, setShowAccentProfile, showAccentExplore, setShowAccentExplore, accentVisibility, setAccentVisibility, theme, setTheme }}>
      {children}
    </I18nContext.Provider>
  );
}
