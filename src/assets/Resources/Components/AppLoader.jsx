import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import './css/appLoader.css';

const MIN_DISPLAY_MS = 500;  // Show loader at least 500ms so it doesn't flash
const FORCE_HIDE_TIMEOUT = 10000; // Force-hide loader after 10s if auth never resolves

export default function AppLoader({ children }) {
  const { loading } = useAuth();
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const startTime = useRef(Date.now());
  const readyRef = useRef(false);
  const forceTimerRef = useRef(null);

  // ── Safety timeout: force-hide loader if auth stays loading too long ──
  useEffect(() => {
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
      const elapsed = Date.now() - startTime.current;
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
      startTime.current = Date.now();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  // ── Loader completamente oculto: renderizar solo la app ──
  if (!showLoader) return children;

  return (
    <>
      {/* Overlay siempre PRIMERO en el fragment — React preserva el DOM element,
          así la transición CSS (opacity 1→0) funciona correctamente */}
      <div className={`app-loader-overlay ${fadeOut ? 'app-loader-overlay--hidden' : ''}`}>
        <div className="app-loader-container">
          <img
            src="/logo.svg"
            alt="Closedoor"
            className="app-loader-logo"
          />
        </div>
      </div>
      {/* Children solo se montan cuando auth ya está resuelto (fadeOut activo) */}
      {fadeOut && children}
    </>
  );
}
