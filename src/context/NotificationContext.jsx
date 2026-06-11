import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
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
              // Evitar duplicados (si ya existe por cache/creación local)
              if (prev.some((n) => n.id === data.id)) return prev;
              const updated = [data, ...prev];
              setCachedNotifications(userId, updated);
              return updated;
            });
            setUnreadCount((prev) => prev + 1);
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
