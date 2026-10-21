import { useEffect, useState } from 'react';
import { getDesktopBridge, isDesktopApp } from '../../services/desktopApp';
import { useI18n } from '../../services/i18n/useI18n';
import Tooltip from './Tooltip';
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
  const { showGlobalBg, t } = useI18n();
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

  // Ctrl+0 (Cmd+0 en macOS): devuelve el zoom al 100%.
  // El menú por defecto de Electron ya trae "Reset Zoom", pero en una ventana
  // sin marco el acelerador no siempre llega (Ctrl+- sí funcionaba, Ctrl+0 no) y
  // el teclado numérico tampoco coincide siempre. Es idempotente, así que no hay
  // doble efecto si el menú también lo maneja.
  useEffect(() => {
    if (!desktop || typeof window.electron?.zoom?.reset !== 'function') return;
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key !== '0') return;
      event.preventDefault();
      window.electron.zoom.reset();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div
      className={`fc-titlebar${isMac ? ' fc-titlebar--mac' : ''}${!showGlobalBg ? ' fc-titlebar--solid' : ''}`}
      onDoubleClick={() => window.electron?.maximize()}
    >
      <span className="fc-titlebar__title">Closedoor</span>

      {!isMac && (
        <div className="fc-titlebar-controls" role="group" aria-label={t('window.controls')}>
          <Tooltip text={t('window.minimize')} placement="bottom" style={{ height: '100%' }}>
            <button
              type="button"
              className="fc-titlebar-btn"
              aria-label={t('window.minimize')}
              onClick={() => window.electron?.minimize()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip text={maximized ? t('window.restore') : t('window.maximize')} placement="bottom" style={{ height: '100%' }}>
            <button
              type="button"
              className="fc-titlebar-btn"
              aria-label={maximized ? t('window.restore') : t('window.maximize')}
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
          </Tooltip>
          <Tooltip text={t('window.close')} placement="bottom" style={{ height: '100%' }}>
            <button
              type="button"
              className="fc-titlebar-btn fc-titlebar-btn--close"
              aria-label={t('window.close')}
              onClick={() => window.electron?.close()}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
