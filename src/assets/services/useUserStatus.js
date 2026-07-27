import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseclient';
import { getCachedFollowStatus } from './followService';

/**
 * useUserStatus — Hook para manejar el estado online/dnd/idle/disconnected
 * del usuario actual y suscribirse al estado de otros usuarios.
 *
 * Mecanismos de sincronización:
 * 1. postgres_changes Realtime (vía DB replication)
 * 2. Polling cada 10s + resync al volver al tab activo
 *
 * @param {string} userId — ID del usuario actual
 * @param {string} otherUserId — ID del usuario a observar
 * @param {boolean} checkMutualFollow — Si true, solo muestra status si hay follow mutuo
 * @returns {{ status: string|null, myStatus: string, setMyStatus: fn }}
 */
export function useUserStatus(userId, otherUserId, checkMutualFollow = false) {
  const [status, setStatus] = useState(null);
  const [myStatus, setMyStatusState] = useState('online');
  const myStatusRef = useRef('online');
  const idleTimerRef = useRef(null);
  const channelRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const autoIdleRef = useRef(false);
  const mountedCleanupRef = useRef(null);

  // ── Actualizar mi estado ──
  const setMyStatus = useCallback(async (newStatus, { auto = false } = {}) => {
    if (!userId) { console.log('[STATUS] setMyStatus skipped — no userId'); return; }
    if (!['online', 'dnd', 'idle', 'disconnected'].includes(newStatus)) return;

    console.log('[STATUS] setMyStatus →', newStatus, auto ? '(auto)' : '(manual)');

    if (!auto) autoIdleRef.current = false;

    myStatusRef.current = newStatus;
    setMyStatusState(newStatus);

    // Guardar en secureStorage
    try {
      const { setItem } = await import('./secureStorage');
      setItem('fc_user_status', newStatus);
      setItem('fc_user_status_auto', auto);
    } catch {}

    // Persistir en DB (dispara postgres_changes Realtime)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ user_status: newStatus })
        .eq('id', userId);
      if (error) console.warn('[STATUS] DB update error:', error);
      else console.log('[STATUS] DB updated OK →', newStatus);
    } catch (err) {
      console.warn('[STATUS] Error updating user_status:', err);
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
        console.log('[STATUS] Mount — saved:', saved, 'wasAuto:', wasAuto);
        if (saved === 'dnd') {
          initialStatus = 'dnd';
        } else if (saved === 'idle' && wasAuto !== true) {
          initialStatus = 'idle';
        }
      } catch {}

      console.log('[STATUS] Mount — initialStatus:', initialStatus);
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
        if (myStatusRef.current === 'idle' && autoIdleRef.current) {
          autoIdleRef.current = false;
          setMyStatus('online', { auto: true });
        }
        resetIdleTimer();
      };

      const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
      events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));

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

      mountedCleanupRef.current = () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        subscription?.unsubscribe();
        events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      };

      // Sync inicial con la DB
      console.log('[STATUS] Mount — syncing DB with:', initialStatus);
      supabase
        .from('profiles')
        .update({ user_status: initialStatus })
        .eq('id', userId)
        .then(({ error }) => {
          if (error) console.warn('[STATUS] Mount DB sync error:', error);
          else console.log('[STATUS] Mount DB sync OK');
        })
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

    // Resetear estado previo (evita flicker)
    setStatus(null);
    let cancelled = false;

    // ── Verificar follow mutuo ──
    const checkVisibility = async () => {
      if (!userId || !checkMutualFollow) return true;

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

    checkVisibility().then((visible) => {
      if (cancelled) return;
      if (!visible) { setStatus(null); return; }

      // ── 1. Fetch initial status ──
      supabase
        .from('profiles')
        .select('user_status')
        .eq('id', otherUserId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data && !cancelled) {
            console.log('[STATUS] Obs — initial fetch result:', data.user_status, 'for', otherUserId);
            setStatus(data.user_status);
          } else if (!cancelled) {
            console.log('[STATUS] Obs — initial fetch no data/error:', error?.message);
          }
        });

      // ── 2. Subscribe a postgres_changes (Realtime vía DB) ──
      const channel = supabase
        .channel(`user-status-${otherUserId}-${userId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${otherUserId}`,
        }, (payload) => {
          if (!cancelled && payload.new.user_status !== undefined) {
            console.log('[STATUS] Obs — postgres_changes received:', payload.new.user_status, '→ old:', payload.old?.user_status);
            setStatus(payload.new.user_status);
          } else if (!cancelled) {
            console.log('[STATUS] Obs — postgres_changes but no user_status in payload');
          }
        })
        .subscribe((subStatus) => {
          console.log('[STATUS] Obs — subscribe status:', subStatus, 'for', otherUserId);
        });

      console.log('[STATUS] Obs — channel created + subscribed for', otherUserId);
      channelRef.current = channel;

      // ── 3. Polling fallback cada 3s (no depende de Realtime) ──
      const pollStatus = async () => {
        if (cancelled) return;
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('user_status')
            .eq('id', otherUserId)
            .maybeSingle();
          if (!cancelled && !error && data?.user_status !== undefined) {
            setStatus(data.user_status);
          }
        } catch {}
      };
      const pollInterval = setInterval(pollStatus, 3000);
      const onVisible = () => { if (!document.hidden) pollStatus(); };
      document.addEventListener('visibilitychange', onVisible);

      // Guardar cleanup extra
      const extraCleanup = () => {
        clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', onVisible);
      };

      // Almacenar channel + cleanup en channelRef
      channelRef.current = { channel, extra: extraCleanup };
    });

    return () => {
      cancelled = true;
      if (channelRef.current) {
        console.log('[STATUS] Obs — cleanup: removing channel + polling for', otherUserId);
        if (channelRef.current.channel) supabase.removeChannel(channelRef.current.channel);
        if (channelRef.current.extra) channelRef.current.extra();
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
