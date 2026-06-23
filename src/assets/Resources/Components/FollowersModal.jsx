import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../services/i18n/useI18n";
import { getFollowers, getFollowing } from "../../services/followService";
import FollowButton from "./FollowButton";
import Avatar from "./Avatar";
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
        <span className="followers-modal-username">{user.username}</span>
        <span className="followers-modal-roles">
          {Array.isArray(user.roles) &&
            user.roles.filter((r) => r !== "user").join(", ")}
        </span>
      </div>

      <div className="followers-modal-action">
        <FollowButton targetUserId={user.id} />
      </div>
    </div>
  );
}

export default function FollowersModal({ userId, type, onClose }) {
  const { t } = useI18n();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef({ followers: null, following: null });

  const isFollowers = type === "followers";
  const title = isFollowers ? t('followers.title') : t('following.title');

  useEffect(() => {
    if (!userId) return;

    const cached = cacheRef.current[type];
    if (cached) {
      setUsers(cached);
      setLoading(false);
      return;
    }

    const fetchUsers = async () => {
      setLoading(true);
      try {
        const data = isFollowers
          ? await getFollowers(userId)
          : await getFollowing(userId);
        cacheRef.current[type] = data || [];
        setUsers(data || []);
      } catch (err) {
        console.warn(`Error fetching ${type}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [userId, type, isFollowers]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fc-modal-overlay" role="dialog" aria-modal="true" onClick={handleOverlayClick}>
      <div className="fc-modal followers-modal">
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
        ) : users.length === 0 ? (
          <div className="followers-modal-empty">
            <p>
              {isFollowers
                ? t('followers.empty')
                : t('following.empty')}
            </p>
          </div>
        ) : (
          <div className="followers-modal-list">
            {users.map((u) => (
              <FollowersModalItem key={u.id} user={u} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
