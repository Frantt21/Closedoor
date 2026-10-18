import { useEffect, useState } from 'react';
import { getDesktopBridge, isDesktopApp } from '../../services/desktopApp';
import './css/titleBar.css';

/**
 * TitleBar — barra de título personalizada de la app de escritorio (Electron).
 *
 * La ventana es `frame: false` en Windows/Linux (y `hiddenInset` en macOS), así
 * que la barra del compositor/OS NO existe: esta franja la sustituye. Es una
 * región arrastrable (`-webkit-app-region: drag`) y, en Windows/Linux, lleva los
 * botones minimizar / maximizar / cerrar que hablan con `window.electron`
 * (desktop/preload.js → IPC → desktop/main.js).
 *
 * En el navegador no se renderiza nada y el layout queda igual: el offset
 * superior se activa con la clase `fc-desktop` en <html> (ver titleBar.css).
 *
 * Lleva SOLO el nombre de la app, centrado (sin logo ni borde inferior); el
 * icono lo pone el sistema operativo (ventana/taskbar) desde desktop/assets.
 * macOS conserva los semáforos nativos: no pintamos botones ahí.
 */
export default function TitleBar() {
  const desktop = isDesktopApp();
  const bridge = getDesktopBridge();
  const platform = bridge?.platform || window.electron?.platform || '';
  const isMac = platform === 'darwin';
  const [maximized, setMaximized] = useState(() => !!window.electron?.isMaximized?.());

  useEffect(() => {
    if (!desktop) return;
    const height = Number(bridge?.titlebarHeight) || 40;
    const root = document.documentElement;
    root.classList.add('fc-desktop');
    root.style.setProperty('--fc-titlebar-h', `${height}px`);
    return () => {
      root.classList.remove('fc-desktop');
      root.style.removeProperty('--fc-titlebar-h');
    };
  }, [desktop, bridge]);

  useEffect(() => {
    if (!desktop || typeof window.electron?.onWindowState !== 'function') return;
    return window.electron.onWindowState((state) => setMaximized(!!state?.maximized));
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div
      className={`fc-titlebar${isMac ? ' fc-titlebar--mac' : ''}`}
      onDoubleClick={() => window.electron?.maximize()}
    >
      <span className="fc-titlebar__title">Foranly</span>

      {!isMac && (
        <div className="fc-titlebar-controls" role="group" aria-label="Controles de ventana">
          <button
            type="button"
            className="fc-titlebar-btn"
            title="Minimizar"
            aria-label="Minimizar"
            onClick={() => window.electron?.minimize()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="fc-titlebar-btn"
            title={maximized ? 'Restaurar' : 'Maximizar'}
            aria-label={maximized ? 'Restaurar' : 'Maximizar'}
            onClick={() => window.electron?.maximize()}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0" y="2.5" width="7.5" height="7.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                <path d="M2.5 2.5 V1 A1 1 0 0 1 3.5 0 H9 A1 1 0 0 1 10 1 V6.5 A1 1 0 0 1 9 7.5 H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="fc-titlebar-btn fc-titlebar-btn--close"
            title="Cerrar"
            aria-label="Cerrar"
            onClick={() => window.electron?.close()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
