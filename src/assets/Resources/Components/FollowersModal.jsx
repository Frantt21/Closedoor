import React, { useEffect, useState, useCallback, useRef } from "react";
import ModalShell from './ModalShell';
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../services/i18n/useI18n";
import { getFollowers, getFollowing, getCachedFollowers, getCachedFollowing, setCachedFollowers, setCachedFollowing } from "../../services/followService";
import FollowButton from "./FollowButton";
import Avatar from "./Avatar";
import Badge from "./Badge";
import "./css/followersModal.css";

function FollowersModalItem({ user, onClose }) {
  const navigate = useNavigate();

  const handleClick = useCallback((e) => {
    if (e.target.closest('.followers-modal-action')) return;
    onClose();
    navigate(`/profile/${user.username}`);
  }, [navigate, onClose, user.username]);

  return (
    <div className="followers-modal-item" onClick={handleClick}>
      <Avatar
        className="followers-modal-avatar"
        src={user.avatar_url}
        alt={user.username}
      />

      <div className="followers-modal-info">
        <div className="followers-modal-name-row">
          <span className="followers-modal-username">{user.username}</span>
          {Array.isArray(user.roles) && user.roles.some(r => r !== 'user') && (
            <span className="followers-modal-badges">
              <Badge roles={user.roles} />
            </span>
          )}
        </div>
      </div>

      <div className="followers-modal-action">
        <FollowButton targetUserId={user.id} />
      </div>
    </div>
  );
}

export default function FollowersModal({ isOpen = true, userId, type, onClose }) {
  const { t } = useI18n();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimeoutRef = useRef(null);

  // Debounce 200ms antes de actualizar el filtro
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery) {
      setDebouncedQuery('');
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 200);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  const isFollowers = type === "followers";
  const title = isFollowers ? t('followers.title') : t('following.title');

  // Scroll locking, Escape handling: manejado por ModalShell (<dialog> nativo)

  // Restaurar cache síncrono en useState para evitar flicker
  const [users, setUsers] = useState(() => {
    if (!userId) return [];
    return isFollowers
      ? getCachedFollowers(userId) || []
      : getCachedFollowing(userId) || [];
  });
  const [loading, setLoading] = useState(() => {
    if (!userId) return true;
    const cached = isFollowers
      ? getCachedFollowers(userId)
      : getCachedFollowing(userId);
    return !cached;
  });

  useEffect(() => {
    if (!userId) return;

    const fetchUsers = async () => {
      setLoading(true);
      try {
        const data = isFollowers
          ? await getFollowers(userId)
          : await getFollowing(userId);
        setUsers(data || []);
        // Actualizar cache
        if (isFollowers) {
          setCachedFollowers(userId, data || []);
        } else {
          setCachedFollowing(userId, data || []);
        }
      } catch (err) {
        console.warn(`Error fetching ${type}:`, err);
      } finally {
        setLoading(false);
      }
    };

    // Siempre hacer fetch en background para refrescar datos
    fetchUsers();
  }, [userId, type, isFollowers]);

  const filteredUsers = debouncedQuery
    ? users.filter((u) =>
        u.username.toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : users;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} onEscape={onClose} className="followers-modal">
        <div className="followers-modal-header">
          <h3 className="fc-modal-title">{title}</h3>
          <button
            type="button"
            className="followers-modal-close"
            onClick={onClose}
            aria-label={t('followers.close')}
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="followers-modal-loading">{t('common.loading')}</div>
        ) : users.length === 0 && !searchQuery ? (
          <div className="followers-modal-empty">
            <p>
              {isFollowers
                ? t('followers.empty')
                : t('following.empty')}
            </p>
          </div>
        ) : (<>
          <div className="followers-modal-search">
            <div className="followers-modal-search-wrap">
              <svg className="followers-modal-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="followers-modal-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isFollowers ? t('followers.search_placeholder') || 'Buscar seguidor...' : t('following.search_placeholder') || 'Buscar siguiendo...'}
                autoFocus
              />
            </div>
          </div>
          {filteredUsers.length === 0 ? (
            <div className="followers-modal-empty">
              <p>{t('followers.search_empty') || 'Sin resultados'}</p>
            </div>
          ) : (
            <div className="followers-modal-list">
              {filteredUsers.map((u) => (
                <FollowersModalItem key={u.id} user={u} onClose={onClose} />
              ))}
            </div>
          )}
        </>)
        }
    </ModalShell>
  );
}
