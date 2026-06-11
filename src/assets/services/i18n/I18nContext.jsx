import React, { createContext, useState, useEffect, useCallback } from 'react';
import es from './locales/es.json';

const LOCALE_KEY = 'fc_locale';
const ACCENT_KEY = 'fc_show_accent';

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

export const I18nContext = createContext({
  locale: 'es',
  t: (key, params) => key,
  setLocale: () => {},
  showAccent: true,
  setShowAccent: () => {},
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getSavedLocale);
  const [translations, setTranslations] = useState(() => locales[getSavedLocale()] || es);
  const [showAccent, setShowAccentState] = useState(getSavedShowAccent);

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
    <I18nContext.Provider value={{ locale, t, setLocale, showAccent, setShowAccent }}>
      {children}
    </I18nContext.Provider>
  );
}
