import { Link, useLocation } from 'react-router-dom';
import { useState, useContext, useEffect, useRef } from 'react';
import './css/header.css';
import { IconHome, IconUser, IconBars, IconBell, IconCompass, IconCog, IconComment, IconUsers } from './ShellIcons';
import { useAuth } from '../../../hooks/useAuth';
import { NotificationContext } from '../../../context/NotificationContext';
import { useI18n } from '../../../assets/services/i18n/useI18n';
import Tooltip from './Tooltip';
import React from 'react';
import { getItem, setItem } from '../../services/secureStorage';

const SIDEBAR_STORAGE_KEY = 'fc_sidebar_collapsed'; // clave antigua (booleano) — para migración y rollback
const SIDEBAR_MODE_KEY = 'fc_sidebar_mode';

const MODES = ['expanded', 'collapsed', 'hover'];

function getInitialMode() {
  // Nuevo formato: 'expanded' | 'collapsed' | 'hover'
  try {
    const stored = getItem(SIDEBAR_MODE_KEY);
    if (MODES.includes(stored)) return stored;
  } catch { /* ignore */ }
  // Migración desde la clave antigua booleana fc_sidebar_collapsed
  try {
    const old = getItem(SIDEBAR_STORAGE_KEY);
    if (old === true) return 'collapsed';
    if (old === false) return 'expanded';
  } catch { /* ignore */ }
  return 'collapsed';
}

function Header() {
  const { isAuthenticated } = useAuth();
  const { unreadCount, unreadChatCount } = useContext(NotificationContext);
  const { t, showGlobalBg } = useI18n();
  const [mode, setMode] = useState(getInitialMode);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const asideRef = useRef(null);
  const location = useLocation();

  // Modo 'hover': colapsado por defecto; se expande mientras el ratón pasa por
  // encima O mientras el foco del teclado esté dentro (accesibilidad).
  const collapsed = mode === 'collapsed' || (mode === 'hover' && !hovering && !focused);

  // Persistir preferencia del modo del sidebar
  useEffect(() => {
    try {
      setItem(SIDEBAR_MODE_KEY, mode);
      // Mantener la clave antigua sincronizada (rollback seguro si se revierte el deploy)
      setItem(SIDEBAR_STORAGE_KEY, mode === 'collapsed');
    } catch { /* ignore */ }
  }, [mode]);

  // Al entrar en modo 'hover': si el cursor ya está sobre el sidebar (p.ej. tras
  // pulsar el botón del footer, que está DENTRO del sidebar) o el foco está
  // dentro, expandir de inmediato. Sin esto, quedaría colapsado hasta que el
  // ratón saliera y volviera a entrar.
  useEffect(() => {
    if (mode !== 'hover') {
      setHovering(false);
      setFocused(false);
      return;
    }
    const el = asideRef.current;
    if (!el) return;
    setHovering(el.matches(':hover'));
    setFocused(el.contains(document.activeElement) && document.activeElement !== document.body);
  }, [mode]);

  const cycleMode = () => {
    setMode((prev) => MODES[(MODES.indexOf(prev) + 1) % MODES.length]);
    setHovering(false);
    setFocused(false);
  };

  // Al salir con el ratón también se quita el foco expandido: el modo hover solo
  // se mantiene expandido mientras el ratón está encima (los usuarios de teclado
  // no disparan mouseleave, así que su expansión por foco sigue intacta).
  const onMouseEnter = mode === 'hover' ? () => setHovering(true) : undefined;
  const onMouseLeave = mode === 'hover' ? () => { setHovering(false); setFocused(false); } : undefined;
  const onFocus = mode === 'hover' ? () => setFocused(true) : undefined;
  const onBlur = mode === 'hover' ? () => setFocused(false) : undefined;

  // En modo 'hover' no hay tooltips: basta pasar el ratón (o tabular) para ver las etiquetas
  const tooltipText = (labelKey) => (collapsed && mode !== 'hover' ? t(labelKey) : '');

  const modeLabel =
    mode === 'expanded' ? t('nav.sidebar_expanded') :
    mode === 'collapsed' ? t('nav.sidebar_collapsed') :
    t('nav.sidebar_hover');

  return (
    <aside
      ref={asideRef}
      className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${!showGlobalBg ? ' sidebar--solid' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
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
        <Tooltip text={tooltipText('nav.home')} placement="right">
          <Link to="/" className={`sidebar-link${location.pathname === '/' ? ' active' : ''}`}>
            <span className="sidebar-icon"><IconHome /></span>
            <span>{t('nav.home')}</span>
          </Link>
        </Tooltip>

        {isAuthenticated ? (
          <>
            <Tooltip text={tooltipText('nav.profile')} placement="right">
              <Link to="/Profile" className={`sidebar-link${location.pathname.toLowerCase() === '/profile' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUser /></span>
                <span>{t('nav.profile')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.explore')} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.chat')} placement="right">
              <Link to="/Chat" className={`sidebar-link${location.pathname.toLowerCase() === '/chat' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconComment /></span>
                {unreadChatCount > 0 && (
                  <span className="sidebar-notif-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>
                )}
                <span>{t('nav.chat')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.comunidades')} placement="right">
              <Link to="/Communities" className={`sidebar-link${location.pathname.toLowerCase() === '/communities' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUsers /></span>
                <span>{t('nav.comunidades')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.notifications')} placement="right">
              <Link to="/Notifications" className={`sidebar-link${location.pathname.toLowerCase() === '/notifications' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconBell /></span>
                {unreadCount > 0 && (
                  <span className="sidebar-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
                <span>{t('nav.notifications')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.settings')} placement="right">
              <Link to="/Settings" className={`sidebar-link${location.pathname.toLowerCase() === '/settings' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCog /></span>
                <span>{t('nav.settings')}</span>
              </Link>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip text={tooltipText('nav.login')} placement="right">
              <Link to="/Login" className={`sidebar-link${location.pathname.toLowerCase() === '/login' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconUser /></span>
                <span>{t('nav.login')}</span>
              </Link>
            </Tooltip>
            <Tooltip text={tooltipText('nav.explore')} placement="right">
              <Link to="/Explore" className={`sidebar-link${location.pathname.toLowerCase() === '/explore' ? ' active' : ''}`}>
                <span className="sidebar-icon"><IconCompass /></span>
                <span>{t('nav.explore')}</span>
              </Link>
            </Tooltip>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <Tooltip text={collapsed && mode !== 'hover' ? t('nav.sidebar_cycle') : ''} placement="right">
        <button
          type="button"
          className="sidebar-link"
          onClick={cycleMode}
          aria-label={`${modeLabel} — ${t('nav.sidebar_cycle')}`}
        >
          <span className="sidebar-icon"><IconBars /></span>
          <span className="sidebar-footer-label">{modeLabel}</span>
        </button>
        </Tooltip>
      </div>
    </aside>
  );
}

export default Header;
