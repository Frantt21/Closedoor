import { Routes, Route, useParams } from 'react-router-dom';
import Header from './assets/Resources/Components/Header.jsx';
import FollowCountsWatcher from './assets/Resources/Components/FollowCountsWatcher.jsx';
import Home from './assets/Pages/Home.jsx';
import Login from './assets/Pages/Sing/Login.jsx';
import Register from './assets/Pages/Sing/Register.jsx';
import Profile from './assets/Pages/profile.jsx';
import Notifications from './assets/Pages/Notifications.jsx';
import Explore from './assets/Pages/Explore.jsx';
import PostDetail from './assets/Pages/PostDetail.jsx';
import Settings from './assets/Pages/Settings.jsx';
import { I18nProvider } from './assets/services/i18n/I18nContext';

function ProfileWrapper() {
  const { username } = useParams();
  return <Profile key={username || 'own'} />;
}

function App() {
  return (
    <I18nProvider>
      {/* Components */}
      <Header />
      <FollowCountsWatcher />

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
        </Routes>
      </main>
    </I18nProvider>
  );
}

export default App;