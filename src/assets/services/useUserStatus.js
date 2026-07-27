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
 * @returns {{ status: string|null, myStatus: string, setMyStatus: fn }}
 */
export function useUserStatus(userId, otherUserId, checkMutualFollow = false) {
  const [status, setStatus] = useState(null); // Estado del otro usuario (o null si no visible)
  const [myStatus, setMyStatusState] = useState('online'); // Estado del usuario actual
  const myStatusRef = useRef('online');
  const idleTimerRef = useRef(null);
  const channelRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const autoIdleRef = useRef(false); // true si el idle fue puesto automáticamente por inactividad
  const mountedCleanupRef = useRef(null);

  // ── Actualizar mi estado en la DB ──
  const setMyStatus = useCallback(async (newStatus, { auto = false } = {}) => {
    if (!userId) return;
    if (!['online', 'dnd', 'idle', 'disconnected'].includes(newStatus)) return;

    if (!auto) {
      autoIdleRef.current = false;
    }

    myStatusRef.current = newStatus;
    setMyStatusState(newStatus);

    // Guardar en secureStorage (status + si fue automático)
    try {
      const { setItem } = await import('./secureStorage');
      setItem('fc_user_status', newStatus);
      setItem('fc_user_status_auto', auto);
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

  // ── Inicializar estado al montar ──
  useEffect(() => {
    if (!userId) return;

    (async () => {
      let initialStatus = 'online';
      try {
        const { getItem } = await import('./secureStorage');
        const saved = getItem('fc_user_status');
        const wasAuto = getItem('fc_user_status_auto');
        // Persistir 'dnd' siempre. Persistir 'idle' solo si fue manual (no automático).
        if (saved === 'dnd') {
          initialStatus = 'dnd';
        } else if (saved === 'idle' && wasAuto !== true) {
          // Manual idle: restaurar. Si fue auto-idle, volver a online al abrir la app.
          initialStatus = 'idle';
        }
      } catch {}

      myStatusRef.current = initialStatus;
      setMyStatusState(initialStatus);

      // ── Setup session token ──
      supabase.auth.getSession().then(({ data: { session } }) => {
        sessionTokenRef.current = session?.access_token || null;
      });
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        sessionTokenRef.current = session?.access_token || null;
      });

      // ── Idle detection ──
      const ACTIVITY_TIMEOUT = 5 * 60 * 1000;

      const resetIdleTimer = () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (myStatusRef.current === 'online') {
          idleTimerRef.current = setTimeout(() => {
            autoIdleRef.current = true;
            setMyStatus('idle', { auto: true });
          }, ACTIVITY_TIMEOUT);
        }
      };

      const onUserActivity = () => {
        // Solo revertir a online si el idle fue automático
        if (myStatusRef.current === 'idle' && autoIdleRef.current) {
          autoIdleRef.current = false;
          setMyStatus('online', { auto: true });
        }
        resetIdleTimer();
      };

      const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
      events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));

      // Iniciar timer solo si es 'online'
      resetIdleTimer();

      // ── Heartbeat cada 30s ──
      const heartbeatRef = { current: null };
      const startHeartbeat = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          const s = myStatusRef.current;
          if (s === 'online' || s === 'idle' || s === 'dnd') {
            supabase
              .from('profiles')
              .update({ user_status: s })
              .eq('id', userId)
              .then()
              .catch(() => {});
          }
        }, 30000);
      };
      startHeartbeat();

      // ── beforeunload: poner disconnected ──
      const SB_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_DATA_API_URL || '';
      const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
      const restOrigin = (() => { try { return new URL(SB_URL).origin; } catch { return ''; } })();

      const handleBeforeUnload = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
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

      // ── Guardar cleanup ──
      mountedCleanupRef.current = () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        subscription?.unsubscribe();
        events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      };

      // Sync inicial con la DB (fire-and-forget)
      supabase
        .from('profiles')
        .update({ user_status: initialStatus })
        .eq('id', userId)
        .then()
        .catch(() => {});
    })();

    return () => {
      if (mountedCleanupRef.current) {
        mountedCleanupRef.current();
        mountedCleanupRef.current = null;
      }
    };
  }, [userId, setMyStatus]);

  // ── Suscribirse al estado de otro usuario ──
  useEffect(() => {
    if (!otherUserId) {
      setStatus(null);
      return;
    }

    const checkVisibility = async () => {
      if (!userId || !checkMutualFollow) {
        return true;
      }

      const iFollowThem = getCachedFollowStatus(userId, otherUserId);
      const theyFollowMe = getCachedFollowStatus(otherUserId, userId);

      if (iFollowThem !== null && theyFollowMe !== null) {
        return iFollowThem === true && theyFollowMe === true;
      }

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

      // Fetch initial status
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

      // Subscribe to Realtime changes
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
            if (!cancelled && payload.new.user_status !== payload.old.user_status) {
              setStatus(payload.new.user_status);
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
