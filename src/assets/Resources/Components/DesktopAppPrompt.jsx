import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaDownload, FaDesktop, FaWindows, FaApple, FaLinux } from 'react-icons/fa';
import ModalShell from './ModalShell';
import { useI18n } from '../../services/i18n/useI18n';
import {
  DESKTOP_PROMPT_EVENT,
  dismissDesktopPrompt,
  isDesktopApp,
  isDesktopPromptDismissed,
} from '../../services/desktopApp';
import {
  DESKTOP_DOWNLOAD_PATH,
  DESKTOP_FEATURES,
  DESKTOP_PLATFORM_GROUPS,
  DESKTOP_RELEASE_URL,
  getDownloadUrl,
} from '../../data/desktopApp';
import './css/desktopAppPrompt.css';

const PLATFORM_ICONS = {
  windows: FaWindows,
  macos: FaApple,
  linux: FaLinux,
};

/**
 * DesktopAppPrompt — aviso "oye la canción completa en la app de escritorio".
 *
 * CUÁNDO SALE: cuando el usuario empieza a reproducir una canción en el
 * NAVEGADOR (SongCard → notifyBrowserPlayback(), services/desktopApp.js). Como
 * mucho una vez por carga de página, nunca dentro de la propia app de escritorio
 * (ahí el stream ya sale del loopback y suena entera) y nunca si el usuario pidió
 * no volver a verlo.
 *
 * BOTONES (mismo contrato que el modal de changelog):
 *   - Descargar → /download (página propia, ver Pages/Download.jsx)
 *   - ✗        → cierra SOLO esta vez (vuelve a salir en la próxima carga)
 *   - "No volver a mostrar" → lo descarta para siempre (localStorage)
 *
 * En desarrollo se abre a mano con `?desktop-prompt` en la URL.
 */
export default function DesktopAppPrompt() {
  const { t } = useI18n();

  const [open, setOpen] = useState(() => {
    if (!import.meta.env.DEV) return false;
    try {
      return new URLSearchParams(window.location.search).has('desktop-prompt');
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handlePrompt = () => {
      // Revalidar aquí: el aviso puede llegar con la pestaña ya en la app de
      // escritorio o con el descarte hecho en otra pestaña.
      if (isDesktopApp() || isDesktopPromptDismissed()) return;
      setOpen(true);
    };
    window.addEventListener(DESKTOP_PROMPT_EVENT, handlePrompt);
    return () => window.removeEventListener(DESKTOP_PROMPT_EVENT, handlePrompt);
  }, []);

  const handleClose = () => setOpen(false);

  const handleDismiss = () => {
    dismissDesktopPrompt();
    setOpen(false);
  };

  return (
    <ModalShell
      isOpen={open}
      onClose={handleClose}
      onEscape={handleClose}
      disableBackdropClose={false}
      className="desktop-prompt"
    >
      {/* Header bar: idéntico al modal de changelog / editar perfil */}
      <div className="fc-modal-header">
        <h3 className="fc-modal-title">
          <FaDesktop className="desktop-prompt-title-icon" />
          {t('desktop.prompt_title')}
        </h3>
        <div className="fc-modal-header-actions">
          <button type="button" className="fc-modal-save" onClick={handleDismiss}>
            {t('desktop.prompt_never')}
          </button>
          <button type="button" className="fc-modal-close" onClick={handleClose} aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="desktop-prompt-inner">
        <p className="desktop-prompt-text">{t('desktop.prompt_body')}</p>

        <ul className="desktop-prompt-list">
          {DESKTOP_FEATURES.map((key) => (
            <li key={key} className="desktop-prompt-item">
              {t(key)}
            </li>
          ))}
        </ul>

        <div className="desktop-prompt-platforms">
          {DESKTOP_PLATFORM_GROUPS.map((group) => {
            const OsIcon = PLATFORM_ICONS[group.os] || FaDesktop;
            return (
              <div key={group.os} className="desktop-prompt-platform-group">
                <span className="desktop-prompt-platform-group-title">
                  <OsIcon aria-hidden="true" />
                  {t(group.labelKey)}
                </span>
                <div className="desktop-prompt-platform-options">
                  {group.options.map((option) => {
                    const url = getDownloadUrl(option);
                    return (
                      <a
                        key={option.id}
                        href={url || DESKTOP_RELEASE_URL}
                        className="desktop-prompt-platform-option"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleClose}
                      >
                        <span className="desktop-prompt-platform-arch">{option.arch}</span>
                        <FaDownload className="desktop-prompt-platform-download" aria-hidden="true" />
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="desktop-prompt-actions">
          <Link to={DESKTOP_DOWNLOAD_PATH} className="desktop-prompt-download" onClick={handleClose}>
            <FaDownload />
            {t('desktop.prompt_download')}
          </Link>
          <button type="button" className="desktop-prompt-later" onClick={handleClose}>
            {t('desktop.prompt_later')}
          </button>
        </div>

        <p className="desktop-prompt-note">{t('desktop.prompt_note')}</p>
      </div>
    </ModalShell>
  );
}
