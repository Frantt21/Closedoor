import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaWindows, FaApple, FaLinux, FaDesktop, FaDownload } from 'react-icons/fa';
import { useI18n } from '../services/i18n/useI18n';
import usePageTitle from '../../hooks/usePageTitle';
import {
  DESKTOP_FEATURES,
  DESKTOP_VERSION,
  DESKTOP_DOWNLOADS,
  getDownloadUrl,
} from '../data/desktopApp';
import '../Resources/Styles/download.css';

/**
 * Download — página propia de descargas de la app de escritorio.
 *
 * Es el destino del aviso que sale al reproducir en el navegador
 * (Components/DesktopAppPrompt.jsx) y de los enlaces que se compartan fuera de la
 * app. Los archivos y su URL base viven en data/desktopApp.js: hasta que no se
 * rellene DESKTOP_DOWNLOAD_BASE, cada tarjeta se muestra como "Próximamente" (sin
 * enlaces rotos).
 */
const OS_ICONS = {
  windows: FaWindows,
  macos: FaApple,
  linux: FaLinux,
};

export default function Download() {
  const { t } = useI18n();
  const navigate = useNavigate();
  usePageTitle(t('download.title') || 'Foranly Desktop');

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  }, [navigate]);

  // Etiquetas literales (no `t(\`download.os_${…}\`)`) para que
  // scripts/validate-locales.mjs las vea y no se queden sin traducir.
  const osLabels = {
    windows: t('download.os_windows') || 'Windows',
    macos: t('download.os_macos') || 'macOS',
    linux: t('download.os_linux') || 'Linux',
  };

  const anyAvailable = DESKTOP_DOWNLOADS.some((entry) => getDownloadUrl(entry));

  return (
    <div className="download-page">
      <div className="download-header">
        <button type="button" className="download-back" onClick={goBack} aria-label={t('common.back')}>
          <FaArrowLeft />
        </button>
        <h1 className="download-title">{t('download.title')}</h1>
      </div>

      <p className="download-subtitle">{t('download.subtitle')}</p>

      {/* ── Por qué existe ── */}
      <section className="download-hero">
        <span className="download-hero-icon">
          <FaDesktop />
        </span>
        <div className="download-hero-body">
          <h2 className="download-hero-title">{t('download.why_title')}</h2>
          <p className="download-hero-text">{t('download.why_body')}</p>
        </div>
      </section>

      {/* ── Ventajas ── */}
      <ul className="download-features">
        {DESKTOP_FEATURES.map((key) => (
          <li key={key} className="download-feature">
            {t(key)}
          </li>
        ))}
      </ul>

      {/* ── Instaladores ── */}
      <section className="download-section">
        <h2 className="download-section-title">{t('download.pick_your_os')}</h2>
        <div className="download-grid">
          {DESKTOP_DOWNLOADS.map((entry) => {
            const url = getDownloadUrl(entry);
            const OsIcon = OS_ICONS[entry.os] || FaDesktop;
            return (
              <article
                key={entry.id}
                className={`download-card${url ? '' : ' download-card--soon'}`}
              >
                <span className="download-card-icon">
                  <OsIcon />
                </span>
                <div className="download-card-body">
                  <h3 className="download-card-title">{osLabels[entry.os] || entry.os}</h3>
                  <span className="download-card-arch">{entry.arch}</span>
                  <span className="download-card-file">{entry.file}</span>
                </div>
                {url ? (
                  <a
                    className="download-card-btn"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FaDownload />
                    {t('download.get')}
                  </a>
                ) : (
                  <span className="download-card-btn download-card-btn--soon">
                    {t('download.soon')}
                  </span>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <p className="download-meta">
        {t('download.version')} {DESKTOP_VERSION}
      </p>
      <p className="download-note">
        {anyAvailable ? t('download.note') : t('download.note_unpublished')}
      </p>
    </div>
  );
}
