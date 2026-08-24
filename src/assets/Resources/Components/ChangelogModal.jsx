import { useState, useEffect } from 'react';
import ModalShell from './ModalShell';
import { useI18n } from '../../services/i18n/useI18n';
import { RELEASES, CHANGELOG_SEEN_KEY } from '../../data/changelog';

/**
 * ChangelogModal — novedades del último deploy.
 *
 * Formato idéntico al modal de editar perfil (fc-modal-header +
 * fc-modal-save / fc-modal-close).
 *
 * - SOLO producción: se abre si el id del último release difiere de
 *   'fc_changelog_seen' (localStorage).
 * - La ✗ cierra SIN marcar como visto (reaparece al recargar).
 * - "Got it" marca como visto → no vuelve a mostrarse.
 * - Los entries se escriben SIEMPRE en inglés; si el locale del usuario es
 *   otro se traducen vía endpoint nativo de Google Translate (dict-chrome-ex,
 *   sin API key), cacheando el resultado por locale+release en localStorage.
 * - En desarrollo solo se abre con ?changelog en la URL.
 */

/**
 * Traducción vía endpoint nativo de Google Translate (el que usa la
 * extensión de Chrome; sin API key, con CORS habilitado). Probado para
 * es/pt/ru/ja. Si falla (sin red, bloqueo de Google) → fallback inglés.
 */
const GT_ENDPOINT = 'https://clients5.google.com/translate_a/t';

async function googleTranslate(text, targetLocale) {
  const url =
    `${GT_ENDPOINT}?client=dict-chrome-ex&sl=en&tl=${encodeURIComponent(targetLocale)}` +
    `&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`translate_failed_${res.status}`);
  const data = await res.json();
  // Respuesta normal: ["texto traducido"]. Con segmentación: [["t1","o1"],...]
  if (!Array.isArray(data)) throw new Error('translate_bad_shape');
  return data.map((seg) => (Array.isArray(seg) ? seg[0] : seg) ?? '').join('');
}

function trCacheKey(locale, releaseId) {
  return `fc_changelog_tr_${locale}_${releaseId}`;
}

function readTrCache(locale, releaseId) {
  try {
    const raw = localStorage.getItem(trCacheKey(locale, releaseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.title && Array.isArray(parsed.items)) return parsed;
  } catch {
    // caché corrupta/bloqueada → ignorar
  }
  return null;
}

function writeTrCache(locale, releaseId, value) {
  try {
    localStorage.setItem(trCacheKey(locale, releaseId), JSON.stringify(value));
  } catch {
    // localStorage lleno/bloqueado → sin caché, se traducirá de nuevo
  }
}

export default function ChangelogModal() {
  const { t, locale } = useI18n();
  const latest = RELEASES[0] || null;

  const [open, setOpen] = useState(() => {
    if (!latest) return false;
    if (import.meta.env.DEV) {
      try {
        return new URLSearchParams(window.location.search).has('changelog');
      } catch {
        return false;
      }
    }
    let seenId = null;
    try {
      seenId = localStorage.getItem(CHANGELOG_SEEN_KEY);
    } catch {
      // localStorage bloqueado → mostrar siempre (mejor 1 popup de más)
    }
    return seenId !== latest.id;
  });

  // Contenido mostrado: inglés (hardcodeado) o traducción cacheada/recién traída
  const [display, setDisplay] = useState(() =>
    latest ? { title: latest.title, items: [...latest.items] } : null
  );

  useEffect(() => {
    let cancelled = false;
    const english = latest ? { title: latest.title, items: [...latest.items] } : null;

    (async () => {
      // Microtask boundary: el setState NO debe correr síncrono dentro del
      // efecto (regla react-compiler / cascading renders)
      await Promise.resolve();
      if (cancelled || !english) return;

      // Inglés = fuente; sin fetch
      if (locale === 'en') {
        setDisplay(english);
        return;
      }

      const cached = readTrCache(locale, latest.id);
      if (cached) {
        setDisplay(cached);
        return;
      }
      try {
        // Traducir título e items por separado (payloads chicos y confiables)
        const [titleTr, ...itemsTr] = await Promise.all([
          googleTranslate(latest.title, locale),
          ...latest.items.map((item) => googleTranslate(item, locale)),
        ]);
        if (cancelled) return;
        if (!titleTr || itemsTr.some((it) => !it)) return; // fallback inglés
        const translated = { title: titleTr, items: itemsTr };
        writeTrCache(locale, latest.id, translated);
        setDisplay(translated);
      } catch {
        // Sin red / endpoint bloqueado → quedarse con inglés
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- latest es dato estático del módulo

  if (!open || !display) return null;

  const handleAccept = () => {
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, latest.id);
    } catch {
      // localStorage bloqueado → solo cerrar, reaparecerá al recargar
    }
    setOpen(false);
  };

  // La ✗ NO marca como visto: solo cierra esta sesión del popup
  const handleClose = () => setOpen(false);

  let dateStr = latest.date;
  try {
    dateStr = new Date(`${latest.date}T12:00:00`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    // fecha inválida → mostrar el raw
  }

  return (
    <ModalShell
      isOpen={open}
      onClose={handleClose}
      onEscape={handleClose}
      disableBackdropClose={true}
      className="changelog-modal"
    >
      {/* ── Header bar: igual al modal de editar perfil ── */}
      <div className="fc-modal-header">
        <h3 className="fc-modal-title">{t('changelog.badge')}</h3>
        <div className="fc-modal-header-actions">
          <button className="fc-modal-save" onClick={handleAccept}>
            {t('changelog.accept')}
          </button>
          <button className="fc-modal-close" onClick={handleClose} aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="changelog-modal-inner">
        <h2 className="changelog-modal-title">{display.title}</h2>
        <span className="changelog-modal-date">{dateStr}</span>
        <ul className="changelog-modal-list">
          {display.items.map((item, i) => (
            <li key={i} className="changelog-modal-item">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </ModalShell>
  );
}
