import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NotificationContext } from '../../context/NotificationContext';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../services/i18n/useI18n';
import { acceptFollowRequest, rejectFollowRequest } from '../services/followService';
import { FaUserPlus, FaHeart, FaComment, FaRetweet, FaBullhorn, FaBell, FaLock, FaCheckSquare, FaCheck, FaTimes } from 'react-icons/fa';
import Avatar from '../Resources/Components/Avatar';
import '../Resources/Styles/notifications.css';
import usePageTitle from '../../hooks/usePageTitle';
import '../Resources/Styles/skeleton.css';

function getIcon(type) {
  switch (type) {
    case 'follow':
    case 'follow_request':
    case 'follow_request_accepted':
    case 'follow_request_rejected':
      return <FaUserPlus />;
    case 'like':
      return <FaHeart />;
    case 'comment':
      return <FaComment />;
    case 'repost':
      return <FaRetweet />;
    case 'comment_like':
      return <FaHeart />;
    case 'mention':
      return <FaBullhorn />;
    case 'encrypted_add':
      return <FaLock />;
    case 'poll_vote':
      return <FaCheckSquare />;
    default:
      return <FaBell />;
  }
}

function getNotificationMessage(t, type, username) {
  switch (type) {
    case 'follow':
      return <><strong>{username}</strong> {t('notifications.followed')}</>;
    case 'follow_request':
      return <><strong>{username}</strong> {t('notifications.follow_request')}</>;
    case 'follow_request_accepted':
      return <><strong>{username}</strong> {t('notifications.follow_request_accepted')}</>;
    case 'follow_request_rejected':
      return <><strong>{username}</strong> {t('notifications.follow_request_rejected')}</>;
    case 'like':
      return <><strong>{username}</strong> {t('notifications.liked')}</>;
    case 'comment':
      return <><strong>{username}</strong> {t('notifications.commented')}</>;
    case 'repost':
      return <><strong>{username}</strong> {t('notifications.reposted')}</>;
    case 'comment_like':
      return <><strong>{username}</strong> {t('notifications.comment_liked')}</>;
    case 'mention':
      return <><strong>{username}</strong> {t('notifications.mentioned')}</>;
    case 'encrypted_add':
      return <><strong>{username}</strong> {t('notifications.encrypted_add')}</>;
    case 'poll_vote':
      return <><strong>{username}</strong> {t('notifications.poll_vote')}</>;
    default:
      return <><strong>{username}</strong> {t('notifications.default')}</>;
  }
}

function getNotificationLink(notification) {
  const actor = notification.actor || {};
  const username = actor.username || '';

  // Notificaciones relacionadas a un post → link al post
  if (['like', 'comment', 'repost', 'comment_like', 'mention', 'encrypted_add', 'poll_vote'].includes(notification.type) && notification.reference_id) {
    return `/post/${notification.reference_id}`;
  }
  // Seguidores → link al perfil del actor
  return `/profile/${username}`;
}

function timeAgo(t, locale, dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return t('post.just_now');
  if (diffMins < 60) return t('post.minutes_ago', { n: diffMins });
  if (diffHours < 24) return t('post.hours_ago', { n: diffHours });
  if (diffDays < 7) return t('post.days_ago', { n: diffDays });
  return date.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric',
    month: 'short',
  });
}

export default function Notifications() {
  const { t, locale } = useI18n();
  usePageTitle(t('notifications.title'));
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteSelected,
  } = useContext(NotificationContext);
  const { user, isAuthenticated } = useAuth();
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingIds, setDeletingIds] = useState(new Set());

  // Reset selection when notifications change (e.g., after delete)
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => notifications.some((n) => n.id === id)));
  }, [notifications]);

  if (!isAuthenticated) {
    return (
      <div className="notifications-page">
        <p>{t('notifications.login_prompt')}</p>
      </div>
    );
  }

  const allSelected =
    notifications.length > 0 && selectedIds.length === notifications.length;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(notifications.map((n) => n.id));
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelectedAction = async () => {
    if (selectedIds.length === 0) return;
    setDeletingIds(new Set(selectedIds));
    await deleteSelected(selectedIds);
    setSelectedIds([]);
    setDeletingIds(new Set());
  };

  const handleDeleteOne = async (id) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    await deleteNotification(id);
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // ── Accept/Reject follow requests ──
  const handleAcceptRequest = async (notif, actorId) => {
    if (!user?.id) return;
    try {
      await acceptFollowRequest(actorId, user.id);
      // Remove the notification after accepting
      deleteNotification(notif.id);
    } catch (err) {
      console.warn('Error accepting follow request:', err);
    }
  };

  const handleRejectRequest = async (notif, actorId) => {
    if (!user?.id) return;
    try {
      await rejectFollowRequest(actorId, user.id);
      deleteNotification(notif.id);
    } catch (err) {
      console.warn('Error rejecting follow request:', err);
    }
  };

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <div className="notifications-header-actions">
          {hasSelection && (
            <span className="notifications-selected-count">
              {selectedIds.length === 1 ? t('notifications.selected_count', { n: selectedIds.length }) : t('notifications.selected_count_plural', { n: selectedIds.length })}
            </span>
          )}
          {unreadCount > 0 && !hasSelection && (
            <button
              type="button"
              className="notifications-mark-all-btn"
              onClick={markAllAsRead}
            >
              {t('notifications.mark_all_read')}
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions bar */}
      {notifications.length > 0 && (
        <div className="notifications-bulk-bar">
          <label className="notifications-checkbox-label">
            <input
              type="checkbox"
              className="notifications-checkbox"
              checked={allSelected}
              onChange={handleSelectAll}
            />
            <span className="notifications-checkbox-custom" />
            {t('notifications.select_all')}
          </label>

          {hasSelection && (
            <button
              type="button"
              className="notifications-delete-selected-btn"
              onClick={handleDeleteSelectedAction}
            >
              {t('notifications.delete_selected', { n: selectedIds.length })}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="notif-skeleton-list">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="notif-skeleton-item">
              <div className="skeleton skeleton--circle notif-skeleton-avatar" />
              <div className="notif-skeleton-content">
                <div className="skeleton notif-skeleton-line" />
                <div className="skeleton notif-skeleton-line notif-skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="notifications-empty">
          <div className="notifications-empty-icon"><FaBell /></div>
          <p className="notifications-empty-text">
            {t('notifications.empty')}
          </p>
          <p className="notifications-empty-subtext">
            {t('notifications.empty_sub')}
          </p>
        </div>
      ) : (
        <div className="notifications-list">
          {notifications.map((notif) => (              <NotificationItem
              key={notif.id}
              notification={notif}
              isSelected={selectedIds.includes(notif.id)}
              isDeleting={deletingIds.has(notif.id)}
              onSelect={() => handleSelectOne(notif.id)}
              onMarkAsRead={markAsRead}
              onDelete={() => handleDeleteOne(notif.id)}
              onAcceptRequest={handleAcceptRequest}
              onRejectRequest={handleRejectRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  isSelected,
  isDeleting,
  onSelect,
  onMarkAsRead,
  onDelete,
  onAcceptRequest,
  onRejectRequest,
}) {
  const { t, locale } = useI18n();
  const actor = notification.actor || {};
  const username = actor.username || '';
  const linkTo = getNotificationLink(notification);
  const postRef = notification.post;

  // Truncar contenido del post para preview
  const postPreview = postRef?.content
    ? postRef.content.length > 100
      ? postRef.content.substring(0, 100) + '...'
      : postRef.content
    : null;

  const handleClick = (e) => {
    if (e.target.closest('.notification-checkbox-area') || e.target.closest('.notification-delete-btn')) {
      return;
    }
    if (!notification.is_read) {
      onMarkAsRead(notification.id);
    }
  };

  const isPostNotification = ['like', 'comment', 'repost', 'comment_like'].includes(notification.type);

  return (
    <div
      className={`notification-item ${!notification.is_read ? 'notification-item--unread' : ''} ${isSelected ? 'notification-item--selected' : ''} ${isDeleting ? 'notification-item--deleting' : ''}`}
      onClick={handleClick}
    >
      <div className="notification-checkbox-area" onClick={(e) => e.stopPropagation()}>
        <label className="notifications-checkbox-label">
          <input
            type="checkbox"
            className="notifications-checkbox"
            checked={isSelected}
            onChange={onSelect}
          />
          <span className="notifications-checkbox-custom" />
        </label>
      </div>

      <div className="notification-type-icon">{getIcon(notification.type)}</div>

      <Link
        to={linkTo}
        className="notification-link"
        onClick={(e) => {
          if (!notification.is_read) {
            onMarkAsRead(notification.id);
          }
        }}
      >
        <Avatar
          className="notification-avatar"
          src={actor.avatar_url}
          alt={username}
        />

        <div className="notification-content">
          <p className="notification-message">
            {getNotificationMessage(t, notification.type, username)}
          </p>
          {/* Preview del contenido del post */}
          {isPostNotification && postPreview && (
            <p className="notification-post-preview">
              &ldquo;{postPreview}&rdquo;
            </p>
          )}
          <span className="notification-time">
            {timeAgo(t, locale, notification.created_at)}
          </span>
        </div>

        {!notification.is_read && (
          <span className="notification-dot" aria-label={t('notifications.unread')} />
        )}
      </Link>

      {/* ── Accept/Reject buttons for follow requests ── */}
      {notification.type === 'follow_request' && (
        <div className="notification-follow-actions">
          <button
            type="button"
            className="notification-accept-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAcceptRequest(notification, notification.actor_id);
            }}
            title={t('notifications.accept')}
          >
            <FaCheck />
          </button>
          <button
            type="button"
            className="notification-reject-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRejectRequest(notification, notification.actor_id);
            }}
            title={t('notifications.reject')}
          >
            <FaTimes />
          </button>
        </div>
      )}

      <button
        type="button"
        className="notification-delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={t('notifications.delete_label')}
        title={t('common.delete')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </div>
  );
}
