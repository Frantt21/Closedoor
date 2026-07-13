import { Link, useLocation } from 'react-router-dom';
import { useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { NotificationContext } from '../../../context/NotificationContext';
import { useI18n } from '../../services/i18n/useI18n';
import Tooltip from './Tooltip';
import {
  FaHome, FaUser, FaBell, FaCompass, FaCog, FaComment, FaUsers
} from 'react-icons/fa';
import './css/mobileNav.css';

export default function MobileNav() {
  const { isAuthenticated, logout } = useAuth();
  const { unreadCount } = useContext(NotificationContext);
  const { t } = useI18n();
  const location = useLocation();
  const [suppressTooltips, setSuppressTooltips] = useState(false);
  const suppressTimer = useRef(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTimeout(suppressTimer.current);
  }, []);

  const handleNavClick = useCallback(() => {
    // Suppress tooltips for 400ms after clicking a nav link,
    // so mobile tooltips don't stay visible after navigation
    setSuppressTooltips(true);
    clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => {
      setSuppressTooltips(false);
    }, 400);
  }, []);

  const isActive = (path) => {
    const current = location.pathname.toLowerCase();
    if (path === '/') return current === '/';
    return current.startsWith(path.toLowerCase());
  };

  return (
    <nav className="mobile-nav">
      <div className="mobile-nav-inner">
        <Tooltip text={t('nav.home')} placement="top" suppress={suppressTooltips}>
          <Link to="/" className={`mobile-nav-link${isActive('/') ? ' active' : ''}`} onClick={handleNavClick}>
            <span className="mobile-nav-icon"><FaHome /></span>
          </Link>
        </Tooltip>

        {isAuthenticated ? (
          <>
            <Tooltip text={t('nav.profile')} placement="top" suppress={suppressTooltips}>
              <Link to="/Profile" className={`mobile-nav-link${isActive('/profile') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaUser /></span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.explore')} placement="top" suppress={suppressTooltips}>
              <Link to="/Explore" className={`mobile-nav-link${isActive('/explore') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaCompass /></span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.chat')} placement="top" suppress={suppressTooltips}>
              <Link to="/Chat" className={`mobile-nav-link${isActive('/chat') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaComment /></span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.comunidades')} placement="top" suppress={suppressTooltips}>
              <Link to="/Communities" className={`mobile-nav-link${isActive('/communities') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaUsers /></span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.notifications')} placement="top" suppress={suppressTooltips}>
              <Link to="/Notifications" className={`mobile-nav-link${isActive('/notifications') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon">
                  <FaBell />
                  {unreadCount > 0 && (
                    <span className="mobile-nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  )}
                </span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.settings')} placement="top" suppress={suppressTooltips}>
              <Link to="/Settings" className={`mobile-nav-link${isActive('/settings') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaCog /></span>
              </Link>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip text={t('nav.explore')} placement="top" suppress={suppressTooltips}>
              <Link to="/Explore" className={`mobile-nav-link${isActive('/explore') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaCompass /></span>
              </Link>
            </Tooltip>
            <Tooltip text={t('nav.login')} placement="top" suppress={suppressTooltips}>
              <Link to="/Login" className={`mobile-nav-link${isActive('/login') ? ' active' : ''}`} onClick={handleNavClick}>
                <span className="mobile-nav-icon"><FaUser /></span>
              </Link>
            </Tooltip>
          </>
        )}
      </div>
    </nav>
  );
}
