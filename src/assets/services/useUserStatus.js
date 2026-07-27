import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseclient';
import { getCachedFollowStatus } from './followService';

/**
 * useUserStatus — Hook para manejar el estado online/dnd/idle/disconnected
 * del usuario actual y suscribirse al estado de otros usuarios via Realtime.
 *
 * @param {string} userId — ID del usuario actual (para actualizar su propio estado)
 * @param {string} otherUserId — ID del usuario a observar (opcional, para perfil/chat)
 * @param {boolean} checkMutualFollow — Si true, solo muestra status si hay follow mutuo
 * @returns {{ status: string|null, setMyStatus: fn }}
 */
export function useUserStatus(userId, otherUserId, checkMutualFollow = false) {
  const [status, setStatus] = useState(null); // Estado del otro usuario (o null si no visible)
  const [myStatus, setMyStatusState] = useState('online'); // Estado del usuario actual
  const myStatusRef = useRef('online');
  const idleTimerRef = useRef(null);
  const channelRef = useRef(null);
  const sessionTokenRef = useRef(null);

  // ── Actualizar mi estado en la DB ──
  const setMyStatus = useCallback(async (newStatus) => {
    if (!userId) return;
    if (!['online', 'dnd', 'idle', 'disconnected'].includes(newStatus)) return;

    myStatusRef.current = newStatus;
    setMyStatusState(newStatus); // ← Actualiza el estado local para re-render

    // ── Sincronizar con localStorage para que NotificationContext pueda leerlo ──
    try {
      const { setItem } = await import('./secureStorage');
      setItem('fc_user_status', newStatus);
    } catch {}

    try {
      await supabase
        .from('profiles')
        .update({ user_status: newStatus })
        .eq('id', userId);
    } catch (err) {
      console.warn('Error updating user_status:', err);
    }
  }, [userId]);

  // ── Inicializar estado al montar (online) ──
  useEffect(() => {
    if (!userId) return;

    // Set initial status to online
    setMyStatus('online');

    // ── Idle detection ──
    const ACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 min de inactividad → idle

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      // Only set idle if current status is online
      if (myStatusRef.current === 'online') {
        idleTimerRef.current = setTimeout(() => {
          setMyStatus('idle');
        }, ACTIVITY_TIMEOUT);
      }
    };

    const onUserActivity = () => {
      // If was idle and now active, go back to online
      if (myStatusRef.current === 'idle') {
        setMyStatus('online');
      }
      resetIdleTimer();
    };

    // Listen for user activity events
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
    events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));

    resetIdleTimer();

    // ── On page unload, set status to disconnected via fetch(keepalive) ──
    const SB_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_DATA_API_URL || '';
    const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
    const restOrigin = (() => { try { return new URL(SB_URL).origin; } catch { return ''; } })();
    // Store initial token
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionTokenRef.current = session?.access_token || null;
    });
    // Keep token refreshed on auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionTokenRef.current = session?.access_token || null;
    });

    const handleBeforeUnload = () => {
      const token = sessionTokenRef.current;
      if (!token || !restOrigin) return;
      try {
        fetch(`${restOrigin}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apiKey': SB_KEY,
            'Authorization': `Bearer ${token}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ user_status: 'disconnected' }),
          keepalive: true,
        });
      } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      subscription?.unsubscribe();
      events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [userId, setMyStatus]);

  // ── Suscribirse al estado de otro usuario ──
  useEffect(() => {
    if (!otherUserId) {
      setStatus(null);
      return;
    }

    // ── Check mutual follow relationship ──
    const checkVisibility = async () => {
      if (!userId || !checkMutualFollow) {
        // No mutual check needed — just observe
        return true;
      }

      // Check mutual follow: I follow them AND they follow me
      const iFollowThem = getCachedFollowStatus(userId, otherUserId);
      const theyFollowMe = getCachedFollowStatus(otherUserId, userId);

      if (iFollowThem !== null && theyFollowMe !== null) {
        return iFollowThem === true && theyFollowMe === true;
      }

      // If cache miss, query DB
      try {
        const [iFollow, theyFollow] = await Promise.all([
          supabase
            .from('follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('follower_id', userId)
            .eq('following_id', otherUserId)
            .eq('status', 'accepted'),
          supabase
            .from('follows')
            .select('follower_id', { count: 'exact', head: true })
            .eq('follower_id', otherUserId)
            .eq('following_id', userId)
            .eq('status', 'accepted'),
        ]);

        return (iFollow.count ?? 0) > 0 && (theyFollow.count ?? 0) > 0;
      } catch (err) {
        console.warn('Error checking mutual follow:', err);
        return false;
      }
    };

    let cancelled = false;

    checkVisibility().then((visible) => {
      if (cancelled) return;

      if (!visible) {
        setStatus(null);
        return;
      }

      // ── Subscribe to Realtime changes on the other user's profile ──
      // First, fetch current status
      supabase
        .from('profiles')
        .select('user_status')
        .eq('id', otherUserId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && !cancelled) {
            setStatus(data.user_status);
          }
        });

      // Then subscribe to changes
      const channel = supabase
        .channel(`user-status-${otherUserId}-${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${otherUserId}`,
          },
          (payload) => {
            if (!cancelled) {
              // Only update if user_status changed
              if (payload.new.user_status !== payload.old.user_status) {
                setStatus(payload.new.user_status);
              }
            }
          }
        )
        .subscribe();

      channelRef.current = channel;
    });

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, otherUserId, checkMutualFollow]);

  return { status, myStatus, setMyStatus };
}

/**
 * Format status to a display string with the correct locale key prefix.
 */
export function getStatusKey(status) {
  switch (status) {
    case 'online': return 'status.online';
    case 'dnd': return 'status.dnd';
    case 'idle': return 'status.idle';
    case 'disconnected': return 'status.disconnected';
    default: return 'status.offline';
  }
}
