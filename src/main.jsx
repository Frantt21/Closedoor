import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import { UserStatusProvider } from './context/UserStatusContext'
import { startDeployWatcher } from './assets/services/deployWatcher'
import './assets/Resources/Styles/global.css'

// ── Hide the pre-rendered hero placeholder as soon as JS executes ──
// This makes the LCP element visible immediately (before React mounts),
// and hides it once the app is ready to render the real Home component.
document.documentElement.classList.add('js-ready');

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
      () => {},
      (err) => console.warn('[SW] Registration failed:', err)
    );
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
  window.visualViewport.addEventListener('scroll', setAppHeight);
}

// ── Detectar un build nuevo desplegado en el servidor (avisa para recargar) ──
startDeployWatcher();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <UserStatusProvider>
            <App />
          </UserStatusProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,)