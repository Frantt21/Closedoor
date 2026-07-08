import { Link, useLocation } from 'react-router-dom';
import { useState, useContext } from 'react';
import './css/header.css';
import { FaHome, FaUser, FaBars, FaBell, FaCompass, FaCog, FaComment, FaUsers } from 'react-icons/fa';
import { MdLogout } from "react-icons/md";
import { useAuth } from '../../../hooks/useAuth';
import { NotificationContext } from '../../../context/NotificationContext';
import { useI18n } from '../../../assets/services/i18n/useI18n';
import Tooltip from './Tooltip';
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
        <Tooltip text={collapsed ? t('nav.home') : ''} placement="right">
          <Link to="/" className={`sidebar-link${location.pathname === '/' ? ' active' : ''}`}>
            <span className="sidebar-icon"><FaHome /></span>
            <span>{t('nav.home')}</span>
          </Link>
        </Tooltip>

        {isAuthenticated ? (
          <>
            <Tooltip text={collapsed ? t('nav.profile') : ''} placement="right">
              <Link to="/Profile" className={`sidebar-link${location.pathname.toLowerCase() === '/profile' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaUser /></span>
                <span>{t('nav.profile')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.explore') : ''} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.chat') : ''} placement="right">
              <Link to="/Chat" className={`sidebar-link${location.pathname.toLowerCase() === '/chat' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaComment /></span>
                <span>{t('nav.chat')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.comunidades') : ''} placement="right">
              <Link to="/Communities" className={`sidebar-link${location.pathname.toLowerCase() === '/communities' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaUsers /></span>
                <span>{t('nav.comunidades')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.notifications') : ''} placement="right">
              <Link to="/Notifications" className={`sidebar-link${location.pathname.toLowerCase() === '/notifications' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaBell /></span>
                {unreadCount > 0 && (
                  <span className="sidebar-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
                <span>{t('nav.notifications')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.settings') : ''} placement="right">
              <Link to="/Settings" className={`sidebar-link${location.pathname.toLowerCase() === '/settings' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaCog /></span>
                <span>{t('nav.settings')}</span>
              </Link>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip text={collapsed ? t('nav.login') : ''} placement="right">
              <Link to="/Login" className={`sidebar-link${location.pathname.toLowerCase() === '/login' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaUser /></span>
                <span>{t('nav.login')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.explore') : ''} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><FaCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {isAuthenticated && (
          <Tooltip text={collapsed ? t('nav.logout') : ''} placement="right">
          <button
            type="button"
            className="sidebar-link"
            onClick={handleLogout}
          >
            <span className="sidebar-icon"><MdLogout /></span>
            <span className="sidebar-footer-label">{t('nav.logout')}</span>
          </button>
          </Tooltip>
        )}

        <Tooltip text={collapsed ? t('nav.collapse_menu') : ''} placement="right">
        <button
          type="button"
          className="sidebar-link"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
        >
          <span className="sidebar-icon"><FaBars /></span>
          <span className="sidebar-footer-label">{collapsed ? t('nav.expand') : t('nav.collapse')}</span>
        </button>
        </Tooltip>
      </div>
    </aside>
  );
}

export default Header;