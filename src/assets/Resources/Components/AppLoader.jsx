import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import './css/appLoader.css';

const MIN_DISPLAY_MS = 500; // Show loader at least 500ms so it doesn't flash

export default function AppLoader({ children }) {
  const { loading } = useAuth();
  const [showLoader, setShowLoader] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const startTime = useRef(Date.now());
  const readyRef = useRef(false);

  useEffect(() => {
    if (!loading && !readyRef.current) {
      readyRef.current = true;
      const elapsed = Date.now() - startTime.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);

      // Wait remaining time then fade out
      const timer = setTimeout(() => {
        setFadeOut(true);
        // After fade animation completes, remove loader from DOM
        setTimeout(() => {
          setShowLoader(false);
        }, 400);
      }, remaining);

      return () => clearTimeout(timer);
    }
  }, [loading]);

  // If both loading and ready (unlikely), show loader
  // If ready and done fading, show children normally
  if (!showLoader) return children;

  return (
    <>
      {children}
      <div className={`app-loader-overlay ${fadeOut ? 'app-loader-overlay--hidden' : ''}`}>
        <div className="app-loader-container">
          <img
            src="/logo.svg"
            alt="Closedoor"
            className="app-loader-logo"
          />
        </div>
      </div>
    </>
  );
}
