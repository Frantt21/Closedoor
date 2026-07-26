import { Link, useLocation } from 'react-router-dom';
import { useState, useContext, useEffect } from 'react';
import './css/header.css';
import { IconHome, IconUser, IconBars, IconBell, IconCompass, IconCog, IconComment, IconUsers } from './ShellIcons';
import { useAuth } from '../../../hooks/useAuth';
import { NotificationContext } from '../../../context/NotificationContext';
import { useI18n } from '../../../assets/services/i18n/useI18n';
import Tooltip from './Tooltip';
import React from 'react';
import { getItem, setItem } from '../../services/secureStorage';

const SIDEBAR_STORAGE_KEY = 'fc_sidebar_collapsed';

function getInitialCollapsed() {
  try {
    const stored = getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) return stored;
  } catch { /* ignore */ }
  return true;
}

function Header() {
  const { isAuthenticated } = useAuth();
  const { unreadCount, unreadChatCount } = useContext(NotificationContext);
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const location = useLocation();

  // Persistir preferencia de sidebar colapsado/expandido
  useEffect(() => {
    try {
      setItem(SIDEBAR_STORAGE_KEY, collapsed);
    } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-brand">
        <Link to="/" className="minicard_profile" style={{ textDecoration: 'none' }}>
          <img
            className="sidebar-brand-logo"
            src="/logo.svg"
            alt="Closedoor"
          />
          <div className="user_nick">
            <p>Closedoor</p>
          </div>
        </Link>
      </div>

      <nav className="sidebar-nav">
        <Tooltip text={collapsed ? t('nav.home') : ''} placement="right">
          <Link to="/" className={`sidebar-link${location.pathname === '/' ? ' active' : ''}`}>
            <span className="sidebar-icon"><IconHome /></span>
            <span>{t('nav.home')}</span>
          </Link>
        </Tooltip>

        {isAuthenticated ? (
          <>
            <Tooltip text={collapsed ? t('nav.profile') : ''} placement="right">
              <Link to="/Profile" className={`sidebar-link${location.pathname.toLowerCase() === '/profile' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUser /></span>
                <span>{t('nav.profile')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.explore') : ''} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.chat') : ''} placement="right">
              <Link to="/Chat" className={`sidebar-link${location.pathname.toLowerCase() === '/chat' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconComment /></span>
                {unreadChatCount > 0 && (
                  <span className="sidebar-notif-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>
                )}
                <span>{t('nav.chat')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.comunidades') : ''} placement="right">
              <Link to="/Communities" className={`sidebar-link${location.pathname.toLowerCase() === '/communities' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUsers /></span>
                <span>{t('nav.comunidades')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.notifications') : ''} placement="right">
              <Link to="/Notifications" className={`sidebar-link${location.pathname.toLowerCase() === '/notifications' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconBell /></span>
                {unreadCount > 0 && (
                  <span className="sidebar-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
                <span>{t('nav.notifications')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.settings') : ''} placement="right">
              <Link to="/Settings" className={`sidebar-link${location.pathname.toLowerCase() === '/settings' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCog /></span>
                <span>{t('nav.settings')}</span>
              </Link>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip text={collapsed ? t('nav.login') : ''} placement="right">
              <Link to="/Login" className={`sidebar-link${location.pathname.toLowerCase() === '/login' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUser /></span>
                <span>{t('nav.login')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={collapsed ? t('nav.explore') : ''} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <Tooltip text={collapsed ? t('nav.collapse_menu') : ''} placement="right">
        <button
          type="button"
          className="sidebar-link"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? t('nav.expand_menu') : t('nav.collapse_menu')}
        >
          <span className="sidebar-icon"><IconBars /></span>
          <span className="sidebar-footer-label">{collapsed ? t('nav.expand') : t('nav.collapse')}</span>
        </button>
        </Tooltip>
      </div>
    </aside>
  );
}

export default Header;