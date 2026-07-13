import { useLayoutEffect } from 'react';
import { Routes, Route, useParams, useLocation } from 'react-router-dom';
import Header from './assets/Resources/Components/Header.jsx';
import FollowCountsWatcher from './assets/Resources/Components/FollowCountsWatcher.jsx';
import BlockRealtimeWatcher from './assets/Resources/Components/BlockRealtimeWatcher.jsx';
import Home from './assets/Pages/Home.jsx';
import Login from './assets/Pages/Sing/Login.jsx';
import Register from './assets/Pages/Sing/Register.jsx';
import Profile from './assets/Pages/profile.jsx';
import Notifications from './assets/Pages/Notifications.jsx';
import Explore from './assets/Pages/Explore.jsx';
import PostDetail from './assets/Pages/PostDetail.jsx';
import Settings from './assets/Pages/Settings.jsx';
import HashtagPage from './assets/Pages/HashtagPage.jsx';
import Chat from './assets/Pages/Chat.jsx';
import Comunidades from './assets/Pages/Comunidades.jsx';
import { I18nProvider } from './assets/services/i18n/I18nContext';
import RightPanel from './assets/Resources/Components/RightPanel';
import AppLoader from './assets/Resources/Components/AppLoader';
import MobileNav from './assets/Resources/Components/MobileNav';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function ProfileWrapper() {
  const { username } = useParams();
  return <Profile key={username || 'own'} />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function App() {
  return (
    <I18nProvider>
      <AppLoader>
        <div className="app-layout">
          {/* Components */}
          <ScrollToTop />
          <Header />
          <FollowCountsWatcher />
          <BlockRealtimeWatcher />

          {/* Pages */}
          <main className="app-content">
            <Routes>
              <Route path="/" element={<Home />} />
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
            </Routes>
          </main>

          <RightPanel />
          <MobileNav />
          <ToastContainer
            position="top-right"
            autoClose={3000}
            hideProgressBar={true}
            newestOnTop
            closeOnClick
            pauseOnFocusLoss={false}
            draggable={false}
            pauseOnHover
            theme="dark"
            closeButton={false}
            toastClassName="fc-toast"
            bodyClassName="fc-toast-body"
          />
        </div>
      </AppLoader>
    </I18nProvider>
  );
}

export default App;