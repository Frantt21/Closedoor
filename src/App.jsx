import { useLayoutEffect, lazy, Suspense } from 'react';
import { Routes, Route, useParams, useLocation } from 'react-router-dom';
import Header from './assets/Resources/Components/Header.jsx';
import FollowCountsWatcher from './assets/Resources/Components/FollowCountsWatcher.jsx';
import BlockRealtimeWatcher from './assets/Resources/Components/BlockRealtimeWatcher.jsx';
import { I18nProvider } from './assets/services/i18n/I18nContext';
import { CallProvider } from './context/CallContext';
import RightPanel from './assets/Resources/Components/RightPanel';
import GlobalProfileBg from './assets/Resources/Components/GlobalProfileBg';
import AppSurfaceTheme from './assets/Resources/Components/AppSurfaceTheme';
import AppLoader from './assets/Resources/Components/AppLoader';
import MobileNav from './assets/Resources/Components/MobileNav';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// ── Lazy-loaded page chunks (code-split per route) ──
const Home = lazy(() => import('./assets/Pages/Home.jsx'));
const Login = lazy(() => import('./assets/Pages/Sing/Login.jsx'));
const Register = lazy(() => import('./assets/Pages/Sing/Register.jsx'));
const Profile = lazy(() => import('./assets/Pages/profile.jsx'));
const AuthCallback = lazy(() => import('./assets/Pages/AuthCallback.jsx'));
const Notifications = lazy(() => import('./assets/Pages/Notifications.jsx'));
const Explore = lazy(() => import('./assets/Pages/Explore.jsx'));
const PostDetail = lazy(() => import('./assets/Pages/PostDetail.jsx'));
const Settings = lazy(() => import('./assets/Pages/Settings.jsx'));
const HashtagPage = lazy(() => import('./assets/Pages/HashtagPage.jsx'));
const Chat = lazy(() => import('./assets/Pages/Chat.jsx'));
const Comunidades = lazy(() => import('./assets/Pages/Comunidades.jsx'));
const CommunityPage = lazy(() => import('./assets/Pages/CommunityPage.jsx'));
const Trending = lazy(() => import('./assets/Pages/Trending.jsx'));

// ── Minimal route-level loading fallback ──
function PageFallback() {
  return (
    <>
      {/* Define keyframes inline so it works regardless of global CSS */}
      <style>{`
        @keyframes fc-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
      }}>
        <div style={{
          width: 28,
          height: 28,
          border: '3px solid var(--color-border, #2a2a2a)',
          borderTopColor: 'var(--color-accent, #6b7280)',
          borderRadius: '50%',
          animation: 'fc-spin 0.7s linear infinite',
        }} />
      </div>
    </>
  );
}

function ProfileWrapper() {
  const { username } = useParams();
  return <Profile key={username || 'own'} />;
}

// ── 404 page for unmatched routes ──
function NotFound() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '60vh',
      padding: '24px',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{
          fontSize: '5rem',
          fontWeight: 800,
          color: 'var(--color-accent, #6b7280)',
          lineHeight: 1,
          marginBottom: 8,
        }}>404</div>
        <div style={{
          width: 48,
          height: 3,
          background: 'var(--color-accent, #6b7280)',
          borderRadius: 2,
          margin: '16px auto',
        }} />
        <h1 style={{
          fontSize: '1.2rem',
          fontWeight: 600,
          marginBottom: 12,
          color: 'var(--color-text, #fff)',
        }}>Página no encontrada</h1>
        <p style={{
          fontSize: '0.9rem',
          lineHeight: 1.6,
          color: 'var(--color-text-secondary, #888)',
          marginBottom: 28,
        }}>
          La página que buscas no existe o ha sido movida.
          Verifica la URL o vuelve al inicio.
        </p>
        <a href="/" style={{
          display: 'inline-block',
          padding: '10px 28px',
          background: 'var(--color-accent, #6b7280)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: '0.9rem',
          fontFamily: 'inherit',
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'background 0.2s ease',
        }}
          onMouseEnter={(e) => e.target.style.background = '#4b5563'}
          onMouseLeave={(e) => e.target.style.background = 'var(--color-accent, #6b7280)'}
        >
          Volver al inicio
        </a>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function App() {
  const location = useLocation();
  const pathname = location.pathname.toLowerCase();
  const isChatRoute = pathname === '/chat';
  // Full-width tipo chat: las comunidades ocupan todo el ancho disponible
  // (grid ancho estilo Explore, sin panel derecho).
  const isFullWidthRoute = isChatRoute || pathname === '/communities' || pathname.startsWith('/c/');

  return (
    <I18nProvider>
      <CallProvider>
      <AppLoader>
        <div className={isChatRoute ? "app-layout app-layout--chat" : "app-layout"}>
          {/* Components */}
          <ScrollToTop />
          {/* Fondo de perfil del usuario a pantalla completa en todo el app
              (solo si la preferencia fc_show_global_bg está activa; excluye
              rutas /profile donde el fondo ya lo pinta la propia página) */}
          <GlobalProfileBg />
          {/* Aplica el tratamiento translúcido/glass del perfil al sidebar
              (mismo estilo que las cards cuando accent_surface_glass está activo) */}
          <AppSurfaceTheme />
          <Header />
          {!isChatRoute && <FollowCountsWatcher />}
          {!isChatRoute && <BlockRealtimeWatcher />}

          {/* Pages (lazy-loaded) */}
          <main className={isFullWidthRoute ? "app-content app-content--full" : "app-content"}>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/Login" element={<Login />} />
                <Route path="/Register" element={<Register />} />
                <Route path="/Profile" element={<Profile key="own" />} />
                <Route path="/profile/:username" element={<ProfileWrapper />} />
                <Route path="/post/:postId" element={<PostDetail />} />
                <Route path="/Notifications" element={<Notifications />} />
                <Route path="/Explore" element={<Explore />} />
                <Route path="/Settings" element={<Settings />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/hashtag/:tag" element={<HashtagPage />} />
                <Route path="/Chat" element={<Chat />} />
                <Route path="/Communities" element={<Comunidades />} />
                <Route path="/c/:slug" element={<CommunityPage />} />
                <Route path="/Trending" element={<Trending />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>

          {!isFullWidthRoute && <RightPanel />}
          <MobileNav />
          <ToastContainer
            position="top-right"
            autoClose={3000}
            hideProgressBar={true}
            newestOnTop
            closeOnClick
            pauseOnFocusLoss
            draggable={false}
            pauseOnHover
            theme="dark"
            closeButton={false}
            toastClassName="fc-toast"
            bodyClassName="fc-toast-body"
          />
        </div>
      </AppLoader>
      </CallProvider>
    </I18nProvider>
  );
}

export default App;