import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { supabase } from '../assets/services/supabaseclient';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteNotifications,
  setCachedNotifications,
  getCachedNotifications,
} from '../assets/services/notificationService';
import { useAuth } from '../hooks/useAuth';

// ── Helpers para notificaciones en vivo ──

const NOTIF_MESSAGES = {
  es: {
    follow: (name) => `${name} te siguió`,
    follow_request: (name) => `${name} quiere seguirte`,
    follow_request_accepted: (name) => `${name} aceptó tu solicitud`,
    follow_request_rejected: (name) => `${name} rechazó tu solicitud`,
    like: (name) => `${name} le gustó tu publicación`,
    comment: (name) => `${name} comentó tu publicación`,
    repost: (name) => `${name} reposteó tu publicación`,
    comment_like: (name) => `${name} le gustó tu comentario`,
    mention: (name) => `${name} te mencionó`,
    default: (name) => `${name} hizo algo`,
  },
  en: {
    follow: (name) => `${name} followed you`,
    follow_request: (name) => `${name} wants to follow you`,
    follow_request_accepted: (name) => `${name} accepted your request`,
    follow_request_rejected: (name) => `${name} rejected your request`,
    like: (name) => `${name} liked your post`,
    comment: (name) => `${name} commented on your post`,
    repost: (name) => `${name} reposted your post`,
    comment_like: (name) => `${name} liked your comment`,
    mention: (name) => `${name} mentioned you`,
    default: (name) => `${name} did something`,
  },
};

function getCurrentLocale() {
  try {
    return localStorage.getItem('fc_locale') || 'es';
  } catch {
    return 'es';
  }
}

function getNotifMessage(type, username) {
  const locale = getCurrentLocale();
  const lang = NOTIF_MESSAGES[locale] || NOTIF_MESSAGES.es;
  const fn = lang[type] || lang.default;
  return fn(username || (locale === 'en' ? 'Someone' : 'Alguien'));
}

function getNotifLink(notif) {
  const username = notif.actor?.username || '';
  if (['like', 'comment', 'repost', 'comment_like', 'mention'].includes(notif.type) && notif.reference_id) {
    return `/post/${notif.reference_id}`;
  }
  return `/profile/${username}`;
}

async function tryShowOsNotification(message, avatarUrl, link, tag) {
  if (!('Notification' in window)) return false;

  // Si nunca se pidió permiso, pedirlo y esperar respuesta
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return false;
  }

  if (Notification.permission !== 'granted') return false;

  try {
    const notif = new Notification('FastChange', {
      body: message,
      icon: avatarUrl || undefined,
      badge: '/favicon.ico',
      tag,
      silent: false,
    });
    notif.onclick = () => {
      window.focus();
      window.location.href = link;
      notif.close();
    };
    return true;
  } catch (err) {
    console.warn('Error showing OS notification:', err);
    return false;
  }
}

function showLiveNotification(data) {
  if (!data?.actor) return;

  // Verificar preferencia del usuario (localStorage)
  try {
    if (localStorage.getItem('fc_show_live_notifications') === 'false') return;
  } catch {}

  const username = data.actor.username || 'Alguien';
  const message = getNotifMessage(data.type, username);
  const link = getNotifLink(data);
  const avatarUrl = data.actor.avatar_url;

  // ── Tab oculto o sin foco → OS Notification ──
  if (document.visibilityState === 'hidden' || !document.hasFocus()) {
    tryShowOsNotification(message, avatarUrl, link, data.id);
    return;
  }

  // ── Tab visible → Toast con React Router Link (evita recarga completa) ──
  toast(
    <Link to={link} className="fc-notif-toast" onClick={(e) => e.stopPropagation()}>
      {avatarUrl && (
        <img
          className="fc-notif-toast-avatar"
          src={avatarUrl}
          alt=""
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}
      <div className="fc-notif-toast-body">
        <span className="fc-notif-toast-text">{message}</span>
      </div>
    </Link>,
    { autoClose: 4000 }
  );
}

export const NotificationContext = createContext();

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;

  // ── Lazy initializers: arrancan con cache si existe, sin skeleton ──
  const [notifications, setNotifications] = useState(() => {
    const cached = getCachedNotifications(userId);
    return cached?.notifications || [];
  });
  const [unreadCount, setUnreadCount] = useState(() => {
    const cached = getCachedNotifications(userId);
    return cached?.unreadCount || 0;
  });
  const [loading, setLoading] = useState(() => {
    return !getCachedNotifications(userId);
  });
  const channelRef = useRef(null);

  // ── Helper: guardar cache (solo notifications, unreadCount se computa al leer) ──
  const saveToCache = useCallback((notifs) => {
    if (!userId) return;
    try {
      setCachedNotifications(userId, notifs);
    } catch (err) {
      console.warn('Could not cache notifications:', err);
    }
  }, [userId]);

  const fetchData = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    // Restaurar cache inmediato (síncrono) antes de fetchear
    const cached = getCachedNotifications(userId);
    if (cached) {
      setNotifications(cached.notifications);
      setUnreadCount(cached.unreadCount);
      setLoading(false);
    }

    try {
      const [notifs, count] = await Promise.all([
        getNotifications(userId),
        getUnreadCount(userId),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
      saveToCache(notifs);
    } catch (err) {
      console.warn('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, saveToCache]);

  // Initial fetch + background refresh
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Realtime subscription ──
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          // Fetch the full notification with actor + post data
          const { data, error } = await supabase
            .from('notifications')
            .select('*, actor:actor_id (id, username, avatar_url), post:reference_id (id, content)')
            .eq('id', payload.new.id)
            .single();

          if (!error && data) {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === data.id)) return prev;
              const updated = [data, ...prev];
              setCachedNotifications(userId, updated);
              return updated;
            });
            setUnreadCount((prev) => prev + 1);
            // Mostrar notificación en vivo (toast u OS según visibilidad del tab)
            showLiveNotification(data);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) => {
            const updated = prev.map((n) =>
              n.id === payload.new.id ? { ...n, ...payload.new } : n
            );
            setCachedNotifications(userId, updated);
            return updated;
          });
          setUnreadCount((prev) => {
            const wasUnread = !payload.old?.is_read;
            const isNowRead = payload.new?.is_read;
            if (wasUnread && isNowRead) return Math.max(0, prev - 1);
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          let wasUnread = false;
          setNotifications((prev) => {
            const removed = prev.find((n) => n.id === payload.old.id);
            wasUnread = !!(removed && !removed.is_read);
            const updated = prev.filter((n) => n.id !== payload.old.id);
            setCachedNotifications(userId, updated);
            return updated;
          });
          if (wasUnread) {
            setUnreadCount((u) => Math.max(0, u - 1));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'posts',
        },
        (payload) => {
          // Cuando se elimina un post, limpiar notificaciones que lo referencian
          // (el CASCADE puede no propagar eventos Realtime correctamente)
          const deletedPostId = payload.old.id;
          if (!deletedPostId) return;

          setNotifications((prev) => {
            const updated = prev.filter((n) => n.reference_id !== deletedPostId);
            if (updated.length === prev.length) return prev;
            saveToCache(updated);
            const newUnread = updated.filter((n) => !n.is_read).length;
            setUnreadCount(newUnread);
            return updated;
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleMarkAsRead = useCallback(async (notificationId) => {
    try {
      await markAsRead(notificationId);
      setNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === notificationId ? { ...n, is_read: true } : n
        );
        saveToCache(updated);
        return updated;
      });
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.warn('Error marking as read:', err);
    }
  }, [saveToCache]);

  const handleMarkAllAsRead = useCallback(async () => {
    if (!userId) return;
    try {
      await markAllAsRead(userId);
      setNotifications((prev) => {
        const updated = prev.map((n) => ({ ...n, is_read: true }));
        saveToCache(updated);
        return updated;
      });
      setUnreadCount(0);
    } catch (err) {
      console.warn('Error marking all as read:', err);
    }
  }, [userId, saveToCache]);

  const handleDeleteNotification = useCallback(async (notificationId) => {
    try {
      await deleteNotification(notificationId);
      let wasUnread = false;
      setNotifications((prev) => {
        const removed = prev.find((n) => n.id === notificationId);
        wasUnread = !!(removed && !removed.is_read);
        const updated = prev.filter((n) => n.id !== notificationId);
        saveToCache(updated);
        return updated;
      });
      if (wasUnread) {
        setUnreadCount((u) => Math.max(0, u - 1));
      }
    } catch (err) {
      console.warn('Error deleting notification:', err);
    }
  }, [saveToCache]);

  const handleDeleteSelected = useCallback(async (notificationIds) => {
    if (!notificationIds || notificationIds.length === 0) return;
    try {
      await deleteNotifications(notificationIds);
      let removedUnreadCount = 0;
      setNotifications((prev) => {
        removedUnreadCount = prev.filter(
          (n) => notificationIds.includes(n.id) && !n.is_read
        ).length;
        const updated = prev.filter((n) => !notificationIds.includes(n.id));
        saveToCache(updated);
        return updated;
      });
      if (removedUnreadCount > 0) {
        setUnreadCount((u) => Math.max(0, u - removedUnreadCount));
      }
    } catch (err) {
      console.warn('Error deleting notifications:', err);
    }
  }, [saveToCache]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead: handleMarkAsRead,
        markAllAsRead: handleMarkAllAsRead,
        deleteNotification: handleDeleteNotification,
        deleteSelected: handleDeleteSelected,
        refresh: fetchData,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
