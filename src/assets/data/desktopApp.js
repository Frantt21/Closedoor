/**
 * desktopApp.js (datos) — versión y enlaces de descarga de la app de escritorio.
 *
 * ÚNICO sitio donde se cambian las URLs de los instaladores: los lee la página
 * /download (Pages/Download.jsx) y el aviso del reproductor
 * (Components/DesktopAppPrompt.jsx). Mantener el número de versión sincronizado
 * con desktop/package.json (los nombres de archivo los genera electron-builder:
 * `Foranly-Setup-<version>.exe`, `Foranly-<version>-<arch>.dmg`, etc.).
 */

export const DESKTOP_VERSION = '0.1.0';

/** Ruta de la página de descargas (a la que apunta el aviso del reproductor). */
export const DESKTOP_DOWNLOAD_PATH = '/download';

/**
 * Base donde se publican los instaladores.
 * ⚠️ Mientras esté vacía, /download muestra los archivos como "Próximamente" en
 * vez de enlaces rotos. Al subir los binarios basta con rellenar esto:
 *   export const DESKTOP_DOWNLOAD_BASE = 'https://dl.foranly.space/desktop';
 */
export const DESKTOP_DOWNLOAD_BASE = '';

/**
 * Instaladores ofrecidos, en el orden en que se muestran.
 * `os` indexa las etiquetas traducidas (download.os_*); `arch` es texto plano.
 */
export const DESKTOP_DOWNLOADS = [
  {
    id: 'windows-x64',
    os: 'windows',
    arch: 'x64',
    file: `Foranly-Setup-${DESKTOP_VERSION}.exe`,
  },
  {
    id: 'macos-arm64',
    os: 'macos',
    arch: 'Apple Silicon',
    file: `Foranly-${DESKTOP_VERSION}-arm64.dmg`,
  },
  {
    id: 'macos-x64',
    os: 'macos',
    arch: 'Intel',
    file: `Foranly-${DESKTOP_VERSION}-x64.dmg`,
  },
  {
    id: 'linux-appimage',
    os: 'linux',
    arch: 'x86_64',
    file: `Foranly-${DESKTOP_VERSION}-x86_64.AppImage`,
  },
  {
    id: 'linux-deb',
    os: 'linux',
    arch: 'amd64 · Debian/Ubuntu',
    file: `Foranly-${DESKTOP_VERSION}-amd64.deb`,
  },
];

/** URL final del instalador ('' si todavía no está publicado). */
export function getDownloadUrl(entry) {
  if (!DESKTOP_DOWNLOAD_BASE || !entry?.file) return '';
  return `${DESKTOP_DOWNLOAD_BASE.replace(/\/+$/, '')}/${entry.file}`;
}

/** Ventajas que lista el aviso del reproductor y la página de descargas. */
export const DESKTOP_FEATURES = [
  'desktop.feature_full',
  'desktop.feature_connection',
  'desktop.feature_same',
];
