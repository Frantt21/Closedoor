import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { supabase } from '../assets/services/supabaseclient';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteNotifications,
  setCachedNotifications,
  getCachedNotifications,
} from '../assets/services/notificationService';
import { decryptMessage, getTotalUnreadChatCount } from '../assets/services/chatService';
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
    encrypted_add: (name) => `${name} te agregó a un post encriptado`,
    poll_vote: (name) => `${name} votó en tu encuesta`,
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
    encrypted_add: (name) => `${name} added you to an encrypted post`,
    poll_vote: (name) => `${name} voted on your poll`,
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
  if (['like', 'comment', 'repost', 'comment_like', 'mention', 'encrypted_add', 'poll_vote'].includes(notif.type) && notif.reference_id) {
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

function isChatRoute() {
  return window.location.pathname.startsWith('/Chat') || window.location.pathname.startsWith('/chat');
}

function showLiveNotification(data, navigate) {
  if (!data?.actor) return;

  // No mostrar toasts si el usuario está en el chat
  if (isChatRoute()) return;

  const username = data.actor.username || 'Alguien';
  const message = getNotifMessage(data.type, username);
  const link = getNotifLink(data);
  const avatarUrl = data.actor.avatar_url;

  // ── Tab oculto o sin foco → OS Notification (si habilitada) ──
  // NOTA: No hacemos return para que el toast también se muestre como fallback
  const isHidden = document.visibilityState === 'hidden' || !document.hasFocus();
  if (isHidden) {
    try {
      if (localStorage.getItem('fc_show_push_notifications') === 'true') {
        tryShowOsNotification(message, avatarUrl, link, data.id);
      }
    } catch {}
  }

  // ── Tab visible (o hidden con push deshabilitada) → Toast (si habilitada) ──
  try {
    if (localStorage.getItem('fc_show_toast_notifications') === 'false') return;
  } catch {}

  toast(
    <div className="fc-notif-toast" onClick={(e) => { e.stopPropagation(); navigate(link); }}>
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
    </div>,
    { autoClose: 4000 }
  );
}

export const NotificationContext = createContext();

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const location = useLocation();
  const navigate = useNavigate();

  // ── Lazy initializers: arrancan con cache si existe, sin skeleton ──
  const [notifications, setNotifications] = useState(() => {
    const cached = getCachedNotifications(userId);
    return cached?.notifications || [];
  });
  const [unreadCount, setUnreadCount] = useState(() => {
    const cached = getCachedNotifications(userId);
    return cached?.unreadCount || 0;
  });
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [loading, setLoading] = useState(() => {
    return !getCachedNotifications(userId);
  });
  const channelRef = useRef(null);

  // ── Throttled helper: unread chat count (max 1 call per 2s) ──
  const fetchUnreadChatCountThrottledRef = useRef(0);
  const fetchUnreadChatCount = useCallback(async () => {
    if (!userId) {
      setUnreadChatCount(0);
      return;
    }
    // Throttle: skip if called within last 2 seconds
    const now = Date.now();
    if (now - fetchUnreadChatCountThrottledRef.current < 2000) return;
    fetchUnreadChatCountThrottledRef.current = now;

    const count = await getTotalUnreadChatCount(userId);
    setUnreadChatCount(count);
  }, [userId]);

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
      const notifs = await getNotifications(userId);
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.is_read).length);
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
              setUnreadCount(updated.filter((n) => !n.is_read).length);
              return updated;
            });
            // Mostrar notificación en vivo (toast u OS según visibilidad del tab)
            showLiveNotification(data, navigate);
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
            setUnreadCount(updated.filter((n) => !n.is_read).length);
            return updated;
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
          setNotifications((prev) => {
            const updated = prev.filter((n) => n.id !== payload.old.id);
            setCachedNotifications(userId, updated);
            setUnreadCount(updated.filter((n) => !n.is_read).length);
            return updated;
          });
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

  // ── Realtime subscription for incoming chat messages (Push + Toast notifications) ──
  useEffect(() => {
    if (!userId) return;

    const chatChannel = supabase
      .channel(`chat-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        async (payload) => {
          const newMsg = payload.new;
          if (!newMsg) return;
          if (newMsg.sender_id === userId) return;
          if (!newMsg.encrypted_for?.includes(userId)) return;

          // Fetch sender profile
          let senderProfile = null;
          try {
            const { data } = await supabase
              .from('profiles')
              .select('id, username, avatar_url')
              .eq('id', newMsg.sender_id)
              .maybeSingle();
            senderProfile = data;
          } catch (err) {
            console.warn('Error fetching profile for chat notification:', err);
          }

          const username = senderProfile?.username || 'Usuario';
          const avatarUrl = senderProfile?.avatar_url;
          let messagePreview = 'Mensaje nuevo';
          try {
            const decrypted = await decryptMessage(newMsg, userId);
            if (decrypted) messagePreview = decrypted;
          } catch (err) {
            console.warn('Error decrypting message for notification:', err);
          }

          const messageText = `@${username}: ${messagePreview}`;

          // Update unread chat count FIRST
          fetchUnreadChatCount();

          // Tab hidden or unfocused → try OS Push Notification (fall through to toast)
          const isHidden = document.visibilityState === 'hidden' || !document.hasFocus();
          if (isHidden) {
            try {
              if (localStorage.getItem('fc_show_push_notifications') === 'true') {
                tryShowOsNotification(messageText, avatarUrl, '/Chat', `chat-msg-${newMsg.id}`);
              }
            } catch (e) {
              console.warn('Error showing OS notification:', e);
            }
          }

          // No mostrar toast si ya estamos en la ruta de chat
          if (!isChatRoute()) {
            try {
              if (localStorage.getItem('fc_show_toast_notifications') === 'false') return;
            } catch (e) {}

            toast(
              <div className="fc-notif-toast" onClick={(e) => { e.stopPropagation(); navigate('/Chat'); }}>
                {avatarUrl && (
                  <img
                    className="fc-notif-toast-avatar"
                    src={avatarUrl}
                    alt=""
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div className="fc-notif-toast-body">
                  <span className="fc-notif-toast-text">{messageText}</span>
                </div>
              </div>,
              { autoClose: 4000 }
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_participants',
          filter: `user_id=eq.${userId}`,
        },
        () => fetchUnreadChatCount()
      )
      .subscribe();

    fetchUnreadChatCount();

    return () => {
      supabase.removeChannel(chatChannel);
    };
  }, [userId, fetchUnreadChatCount]);

  // ── Refresh unread chat count on navigation (enter/leave chat) ──
  useEffect(() => {
    if (!userId) return;
    fetchUnreadChatCount();
  }, [userId, fetchUnreadChatCount, location.pathname]);

  // ── Update browser tab title with combined unread count (notif + chat) ──
  useEffect(() => {
    const total = unreadCount + unreadChatCount;
    // Strip existing badge prefix if any
    const clean = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = total > 0 ? `(${total}) ${clean}` : clean;
  }, [unreadCount, unreadChatCount, location.pathname]);

  const handleMarkAsRead = useCallback(async (notificationId) => {
    try {
      await markAsRead(notificationId);
      setNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === notificationId ? { ...n, is_read: true } : n
        );
        saveToCache(updated);
        setUnreadCount(updated.filter((n) => !n.is_read).length);
        return updated;
      });
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
        setUnreadCount(0);
        return updated;
      });
    } catch (err) {
      console.warn('Error marking all as read:', err);
    }
  }, [userId, saveToCache]);

  const handleDeleteNotification = useCallback(async (notificationId) => {
    try {
      await deleteNotification(notificationId);
      setNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== notificationId);
        saveToCache(updated);
        setUnreadCount(updated.filter((n) => !n.is_read).length);
        return updated;
      });
    } catch (err) {
      console.warn('Error deleting notification:', err);
    }
  }, [saveToCache]);

  const handleDeleteSelected = useCallback(async (notificationIds) => {
    if (!notificationIds || notificationIds.length === 0) return;
    try {
      await deleteNotifications(notificationIds);
      setNotifications((prev) => {
        const updated = prev.filter((n) => !notificationIds.includes(n.id));
        saveToCache(updated);
        setUnreadCount(updated.filter((n) => !n.is_read).length);
        return updated;
      });
    } catch (err) {
      console.warn('Error deleting notifications:', err);
    }
  }, [saveToCache]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        unreadChatCount,
        loading,
        markAsRead: handleMarkAsRead,
        markAllAsRead: handleMarkAllAsRead,
        deleteNotification: handleDeleteNotification,
        deleteSelected: handleDeleteSelected,
        refresh: fetchData,
        refreshChatUnread: fetchUnreadChatCount,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
