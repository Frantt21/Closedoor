import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import './assets/Resources/Styles/global.css'

// Fix mobile viewport height when virtual keyboard opens.
// Sets a CSS variable `--app-height` to the current viewport height (px).
function setAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);

// ── Register Service Worker for offline support and instant navigation ──
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => console.log('[SW] Registered:', reg.scope),
      (err) => console.warn('[SW] Registration failed:', err)
    );
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
  window.visualViewport.addEventListener('scroll', setAppHeight);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,)