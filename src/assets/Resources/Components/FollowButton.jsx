import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import {
  followUser,
  unfollowUser,
  requestFollow,
  cancelFollowRequest,
  hasPendingRequest,
  isFollowing,
  getCachedFollowStatus,
} from '../../services/followService';
import { useI18n } from '../../services/i18n/useI18n';
import './css/followButton.css';

export default function FollowButton({ targetUserId, isPrivate, onFollowChange }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const [following, setFollowing] = useState(() => {
    const cached = getCachedFollowStatus(user?.id, targetUserId);
    return cached ?? false;
  });
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(() => {
    const cached = getCachedFollowStatus(user?.id, targetUserId);
    return cached === null;
  });
  const [hovering, setHovering] = useState(false);

  // Check follow status AND pending request status
  const checkStatus = useCallback(async () => {
    if (!user?.id || !targetUserId || user.id === targetUserId) {
      setLoading(false);
      return;
    }
    try {
      const status = await isFollowing(user.id, targetUserId);
      setFollowing(status);
      if (!status && isPrivate) {
        const pending = await hasPendingRequest(user.id, targetUserId);
        setRequested(pending);
      } else {
        setRequested(false);
      }
    } catch (err) {
      console.warn('Error checking follow status:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, targetUserId, isPrivate]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // If it's the own profile, don't render anything
  if (!user?.id || !targetUserId || user.id === targetUserId) {
    return null;
  }

  const handleClick = async () => {
    if (loading) return;

    // Si el perfil es privado y ya lo sigues, advertir antes de dejar de seguir
    if (following && isPrivate) {
      const confirmed = window.confirm(t('follow.unfollow_private_warning'));
      if (!confirmed) return;
    }

    setLoading(true);

    try {
      if (following) {
        await unfollowUser(user.id, targetUserId);
        onFollowChange?.('unfollow');
      } else if (requested) {
        await cancelFollowRequest(user.id, targetUserId);
        onFollowChange?.('unfollow');
      } else if (isPrivate) {
        await requestFollow(user.id, targetUserId);
        onFollowChange?.('request');
      } else {
        await followUser(user.id, targetUserId);
        onFollowChange?.('follow');
      }
      // Re-check server state to stay in sync
      await checkStatus();
    } catch (err) {
      console.warn('Follow action error:', err);
      // Re-check anyway to recover from any inconsistency
      checkStatus();
    } finally {
      setLoading(false);
    }
  };

  let buttonClass = 'follow-btn';
  let buttonText = t('follow.follow');

  if (following) {
    buttonClass += ' follow-btn--following';
    buttonText = hovering ? t('follow.unfollow') : t('follow.following');
  } else if (requested) {
    buttonClass += ' follow-btn--requested';
    buttonText = hovering ? t('follow.cancel_request') : t('follow.requested');
  } else if (isPrivate) {
    buttonClass += ' follow-btn--request';
    buttonText = t('follow.request');
  } else {
    buttonClass += ' follow-btn--follow';
  }

  return (
    <button
      type="button"
      className={buttonClass}
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
      disabled={loading}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {loading ? '...' : buttonText}
    </button>
  );
}
