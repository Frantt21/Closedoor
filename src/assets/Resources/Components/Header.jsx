import { Link, useLocation } from 'react-router-dom';
import { useState, useContext } from 'react';
import './css/header.css';
import { FaHome, FaUser, FaBars, FaBell, FaCompass, FaCog, FaComment, FaUsers } from 'react-icons/fa';
import { MdLogout } from "react-icons/md";
import { useAuth } from '../../../hooks/useAuth';
import { NotificationContext } from '../../../context/NotificationContext';
import { useI18n } from '../../../assets/services/i18n/useI18n';
import React from 'react';

function Header() {
  const { user, profile, isAuthenticated, logout } = useAuth();
  const { unreadCount } = useContext(NotificationContext);
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const location = useLocation();

  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null;
  const displayName =
    profile?.username ||
    user?.user_metadata?.display_name ||
    user?.user_metadata?.displayname ||
    user?.user_metadata?.username ||
    user?.email?.split('@')[0] ||
    'Guest';

  const handleLogout = async () => {
    await logout();
  };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="minicard_profile">
          <div>
              <img
                className="user_pfp"
                src={avatarUrl || 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg'}
                alt="User Profile Picture"
              />
            </div>

          {isAuthenticated ? (
            <div className="user_nick">
              <p>{displayName}</p>
            </div>
          ) : (
            <div className="user_nick">
              <p>{t('common.username')}</p>
            </div>
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link to="/" className={`sidebar-link${location.pathname === '/' ? ' active' : ''}`}>
          <span className="sidebar-icon"><FaHome /></span>
          <span>{t('nav.home')}</span>
        </Link>

        {isAuthenticated ? (
          <>
            <Link to="/Profile" className={`sidebar-link${location.pathname.toLowerCase() === '/profile' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaUser /></span>
              <span>{t('nav.profile')}</span>
            </Link>
            <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaCompass /></span>
              <span>{t('nav.explore')}</span>
            </Link>
            <Link to="/Chat" className={`sidebar-link${location.pathname.toLowerCase() === '/chat' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaComment /></span>
              <span>{t('nav.chat')}</span>
            </Link>
            <Link to="/Comunidades" className={`sidebar-link${location.pathname.toLowerCase() === '/comunidades' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaUsers /></span>
              <span>{t('nav.comunidades')}</span>
            </Link>
            <Link to="/Notifications" className={`sidebar-link${location.pathname.toLowerCase() === '/notifications' ? ' active' : ''}`}>
              <span className="sidebar-icon">
                <FaBell />
              </span>
              {unreadCount > 0 && (
                <span className="sidebar-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
              <span>{t('nav.notifications')}</span>
            </Link>
            <Link to="/Settings" className={`sidebar-link${location.pathname.toLowerCase() === '/settings' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaCog /></span>
              <span>{t('nav.settings')}</span>
            </Link>
          </>
        ) : (
          <>
            <Link to="/Login" className={`sidebar-link${location.pathname.toLowerCase() === '/login' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaUser /></span>
              <span>{t('nav.login')}</span>
            </Link>
            <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
              <span className="sidebar-icon"><FaCompass /></span>
              <span>{t('nav.explore')}</span>
            </Link>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {isAuthenticated && (
          <button
            type="button"
            className="sidebar-link"
            onClick={handleLogout}
          >
            <span className="sidebar-icon"><MdLogout /></span>
            <span className="sidebar-footer-label">{t('nav.logout')}</span>
          </button>
        )}

        <button
          type="button"
          className="sidebar-link"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
        >
          <span className="sidebar-icon"><FaBars /></span>
          <span className="sidebar-footer-label">{collapsed ? t('nav.expand') : t('nav.collapse')}</span>
        </button>
      </div>
    </aside>
  );
}

export default Header;