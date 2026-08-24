import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import './css/appLoader.css';

const MIN_DISPLAY_MS = 500;  // Show loader at least 500ms so it doesn't flash
const FORCE_HIDE_TIMEOUT = 10000; // Force-hide loader after 10s if auth never resolves

export default function AppLoader({ children }) {
  const { loading } = useAuth();
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const startTimeRef = useRef(0);
  const readyRef = useRef(false);
  const forceTimerRef = useRef(null);

  // ── Boot: timestamp de inicio + safety timeout ──
  // (Date.now() vive aquí DENTRO del efecto: llamarlo en render es impuro)
  useEffect(() => {
    startTimeRef.current = Date.now();

    // Safety timeout: force-hide loader if auth stays loading too long
    forceTimerRef.current = setTimeout(() => {
      if (!readyRef.current) {
        console.warn('[AppLoader] Auth loading timed out — force-hiding loader');
        readyRef.current = true;
        setFadeOut(true);
        setTimeout(() => setShowLoader(false), 400);
      }
    }, FORCE_HIDE_TIMEOUT);

    return () => clearTimeout(forceTimerRef.current);
  }, []);

  // ── Normal flow: hide loader when auth resolves ──
  useEffect(() => {
    if (!loading && !readyRef.current) {
      readyRef.current = true;
      clearTimeout(forceTimerRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

      const timer = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          setShowLoader(false);
        }, 400);
      }, remaining);

      return () => clearTimeout(timer);
    }
  }, [loading]);

  // ── Handle bfcache / page-restore: reset so new auth check drives the loader ──
  useEffect(() => {
    const onShow = () => {
      readyRef.current = false;
      startTimeRef.current = Date.now();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // ── Árbol SIEMPRE con la misma forma: fragment [overlay, children] ──
  // Antes se hacía `if (!showLoader) return children;`: al pasar de
  // <Fragment>[overlay, children]</Fragment> a solo children, React considera
  // que la raíz cambió y DESMONTA Y REMONTA toda la app (los modales nativos
  // abiertos parpadean/cierran-y-abren, y el estado ya cargado de las páginas
  // se descarta y refetchea). Ahora el overlay permanece en el DOM oculto con
  // display:none y los children nunca se desmontan.
  return (
    <>
      {/* Overlay siempre PRIMERO en el fragment — React preserva el DOM element,
          así la transición CSS (opacity 1→0) funciona correctamente */}
      <div
        className={`app-loader-overlay ${fadeOut ? 'app-loader-overlay--hidden' : ''}`}
        style={showLoader ? undefined : { display: 'none' }}
      >
        <div className="app-loader-container">
          <img
            src="/logo.svg"
            alt="Closedoor"
            className="app-loader-logo"
          />
        </div>
      </div>
      {/* Children solo se montan cuando auth ya está resuelto (fadeOut activo),
          y una vez montados JAMÁS se desmontan */}
      {(fadeOut || !showLoader) && children}
    </>
  );
}
