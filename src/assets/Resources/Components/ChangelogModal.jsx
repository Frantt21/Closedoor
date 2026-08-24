import { useState } from 'react';
import ModalShell from './ModalShell';
import { useI18n } from '../../services/i18n/useI18n';
import { RELEASES, CHANGELOG_SEEN_KEY } from '../../data/changelog';
import './css/changelogModal.css';

/**
 * ChangelogModal — muestra las novedades del último deploy.
 *
 * - SOLO producción: se abre automáticamente si el id del release más
 *   reciente difiere de 'fc_changelog_seen' (localStorage).
 * - El botón "Entendido" guarda el id → no vuelve a aparecer.
 * - Cerrar con Escape cierra sin marcar como visto (reaparece al recargar).
 * - En desarrollo solo se abre con ?changelog en la URL (para previsualizar).
 */
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

  if (!open || !latest) return null;

  const handleAccept = () => {
    try {
      localStorage.setItem(CHANGELOG_SEEN_KEY, latest.id);
    } catch {
      // localStorage bloqueado → solo cerrar, reaparecerá al recargar
    }
    setOpen(false);
  };

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
      onClose={() => setOpen(false)}
      onEscape={() => setOpen(false)}
      disableBackdropClose={true}
      className="changelog-modal"
    >
      <div className="changelog-modal-inner">
        <div className="changelog-modal-header">
          <span className="changelog-modal-badge">{t('changelog.badge')}</span>
          <h2 className="changelog-modal-title">{latest.title}</h2>
          <span className="changelog-modal-date">{dateStr}</span>
        </div>
        <ul className="changelog-modal-list">
          {latest.items.map((item, i) => (
            <li key={i} className="changelog-modal-item">
              {item}
            </li>
          ))}
        </ul>
        <button type="button" className="changelog-modal-accept" onClick={handleAccept}>
          {t('changelog.accept')}
        </button>
      </div>
    </ModalShell>
  );
}
