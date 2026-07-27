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
  const [statuses, setStatuses] = useState({});
  const [myStatus, setMyStatusState] = useState('online');
  const myStatusRef = useRef('online');
  const idleTimerRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const autoIdleRef = useRef(false);
  const mountedCleanupRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastLocalChangeAtRef = useRef(0);
  const STALE_STATUS_THRESHOLD_MS = 2 * 60 * 1000;

  const getPresenceRegistryKey = useCallback(() => `fc_presence_sessions:${userId || 'anon'}`, [userId]);

  const readPresenceSessions = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(getPresenceRegistryKey());
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [getPresenceRegistryKey]);

  const writePresenceSessions = useCallback((sessions) => {
    try {
      window.localStorage.setItem(getPresenceRegistryKey(), JSON.stringify(sessions));
    } catch {}
  }, [getPresenceRegistryKey]);

  const computeEffectiveStatus = useCallback((sessions) => {
    const entries = Object.values(sessions || {}).filter(Boolean);
    if (entries.some((entry) => entry.status === 'dnd')) return 'dnd';
    if (entries.some((entry) => entry.status === 'idle')) return 'idle';
    if (entries.some((entry) => entry.status === 'online')) return 'online';
    return 'disconnected';
  }, []);

  const persistPresence = useCallback(async (newStatus, { force = false } = {}) => {
    if (!userId) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_status, user_status_updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (!force && !error && data?.user_status !== undefined) {
        const remoteUpdatedAt = data.user_status_updated_at;
        const remoteTs = remoteUpdatedAt ? new Date(remoteUpdatedAt).getTime() : 0;
        const localTs = lastLocalChangeAtRef.current;
        if (remoteTs > localTs && data.user_status !== newStatus) {
          myStatusRef.current = data.user_status;
          setMyStatusState(data.user_status);
          return data.user_status;
        }
      }

      const payload = {
        user_status: newStatus,
        user_status_updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', userId);

      if (updateError) console.warn('[STATUS] DB update error:', updateError);
      else console.log('[STATUS] DB updated OK →', newStatus);
      return newStatus;
    } catch (err) {
      console.warn('[STATUS] Error updating user_status:', err);
      return newStatus;
    }
  }, [userId]);

  const syncPresenceRegistry = useCallback(async (status, { active = true, force = false } = {}) => {
    if (!userId || !sessionIdRef.current) return null;

    const sessions = readPresenceSessions();
    sessions[sessionIdRef.current] = {
      status,
      updatedAt: new Date().toISOString(),
      active,
    };

    const cleaned = Object.fromEntries(
      Object.entries(sessions).filter(([, entry]) => {
        if (!entry || typeof entry !== 'object' || !entry.updatedAt) return false;
        const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
        return ageMs <= STALE_STATUS_THRESHOLD_MS;
      })
    );

    writePresenceSessions(cleaned);

    const effectiveStatus = computeEffectiveStatus(cleaned);
    if (force || effectiveStatus !== myStatusRef.current) {
      myStatusRef.current = effectiveStatus;
      setMyStatusState(effectiveStatus);
      await persistPresence(effectiveStatus, { force: true });
    }

    return effectiveStatus;
  }, [userId, readPresenceSessions, writePresenceSessions, computeEffectiveStatus, persistPresence]);

  const unregisterPresenceSession = useCallback(async () => {
    if (!userId || !sessionIdRef.current) return null;

    const sessions = readPresenceSessions();
    delete sessions[sessionIdRef.current];
    writePresenceSessions(sessions);

    const effectiveStatus = computeEffectiveStatus(sessions);
    myStatusRef.current = effectiveStatus;
    setMyStatusState(effectiveStatus);
    await persistPresence(effectiveStatus, { force: true });
    return effectiveStatus;
  }, [userId, readPresenceSessions, writePresenceSessions, computeEffectiveStatus, persistPresence]);

  // ── Actualizar mi estado ──
  const setMyStatus = useCallback(async (newStatus, { auto = false } = {}) => {
    if (!userId) { console.log('[STATUS] setMyStatus skipped — no userId'); return; }
    if (!['online', 'dnd', 'idle', 'disconnected'].includes(newStatus)) return;

    console.log('[STATUS] setMyStatus →', newStatus, auto ? '(auto)' : '(manual)');

    if (!auto) autoIdleRef.current = false;

    lastLocalChangeAtRef.current = Date.now();
    myStatusRef.current = newStatus;
    setMyStatusState(newStatus);

    // Guardar en secureStorage
    try {
      const { setItem } = await import('./secureStorage');
      setItem('fc_user_status', newStatus);
      setItem('fc_user_status_auto', auto);
    } catch {}

    // Persistir en DB (dispara postgres_changes Realtime)
    await syncPresenceRegistry(newStatus, { force: true });
  }, [syncPresenceRegistry]);

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
      sessionIdRef.current = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      lastLocalChangeAtRef.current = Date.now();
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

      const handleStorageChange = async (event) => {
        if (event.key !== getPresenceRegistryKey()) return;
        const sessions = readPresenceSessions();
        const effectiveStatus = computeEffectiveStatus(sessions);
        if (effectiveStatus !== myStatusRef.current) {
          myStatusRef.current = effectiveStatus;
          setMyStatusState(effectiveStatus);
        }
      };
      window.addEventListener('storage', handleStorageChange);

      resetIdleTimer();

      // ── Heartbeat cada 30s ──
      const heartbeatRef = { current: null };
      const startHeartbeat = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          const s = myStatusRef.current;
          if (s === 'online' || s === 'idle' || s === 'dnd') {
            syncPresenceRegistry(s).catch(() => {});
          }
        }, 30000);
      };
      startHeartbeat();

      // ── beforeunload/pagehide: poner disconnected ──
      const SB_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_DATA_API_URL || '';
      const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
      const restOrigin = (() => { try { return new URL(SB_URL).origin; } catch { return ''; } })();

      const handleDisconnect = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        unregisterPresenceSession().catch(() => {});
      };
      window.addEventListener('beforeunload', handleDisconnect);
      window.addEventListener('pagehide', handleDisconnect);

      mountedCleanupRef.current = () => {
        window.removeEventListener('beforeunload', handleDisconnect);
        window.removeEventListener('pagehide', handleDisconnect);
        window.removeEventListener('storage', handleStorageChange);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        subscription?.unsubscribe();
        events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        unregisterPresenceSession().catch(() => {});
      };

      // Sync inicial con la DB
      console.log('[STATUS] Mount — syncing DB with:', initialStatus);
      syncPresenceRegistry(initialStatus, { force: true }).catch(() => {});
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
    const targetIds = (Array.isArray(otherUserId) ? otherUserId : [otherUserId]).filter(Boolean);
    const isMultiTarget = Array.isArray(otherUserId);

    if (targetIds.length === 0) {
      setStatus(null);
      setStatuses({});
      return;
    }

    const normalizedIds = [...new Set(targetIds)];
    setStatus(null);
    setStatuses({});
    let cancelled = false;
    const cleanupFns = [];

    const updateStatusForUser = (targetId, value) => {
      if (cancelled) return;
      if (isMultiTarget) {
        setStatuses(prev => (prev[targetId] === value ? prev : { ...prev, [targetId]: value }));
      } else {
        setStatus(value);
      }
    };

    const subscribeToUserStatus = async (targetId) => {
      if (!targetId || cancelled) return;

      // ── Verificar follow mutuo ──
      const checkVisibility = async () => {
        if (!userId || !checkMutualFollow) return true;

        const iFollowThem = getCachedFollowStatus(userId, targetId);
        const theyFollowMe = getCachedFollowStatus(targetId, userId);

        if (iFollowThem !== null && theyFollowMe !== null) {
          return iFollowThem === true && theyFollowMe === true;
        }

        try {
          const [iFollow, theyFollow] = await Promise.all([
            supabase
              .from('follows')
              .select('follower_id', { count: 'exact', head: true })
              .eq('follower_id', userId)
              .eq('following_id', targetId)
              .eq('status', 'accepted'),
            supabase
              .from('follows')
              .select('follower_id', { count: 'exact', head: true })
              .eq('follower_id', targetId)
              .eq('following_id', userId)
              .eq('status', 'accepted'),
          ]);
          return (iFollow.count ?? 0) > 0 && (theyFollow.count ?? 0) > 0;
        } catch (err) {
          console.warn('Error checking mutual follow:', err);
          return false;
        }
      };

      const visible = await checkVisibility();
      if (cancelled) return;
      if (!visible) {
        updateStatusForUser(targetId, null);
        return;
      }

      // ── 1. Fetch initial status ──
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_status, user_status_updated_at')
          .eq('id', targetId)
          .maybeSingle();

        if (!cancelled && !error && data?.user_status !== undefined) {
          const normalizedStatus = (() => {
            const rawStatus = data.user_status;
            const updatedAt = data.user_status_updated_at;
            if (rawStatus === 'disconnected') return 'disconnected';
            if (!updatedAt) return rawStatus;
            const ageMs = Date.now() - new Date(updatedAt).getTime();
            return ageMs > STALE_STATUS_THRESHOLD_MS ? 'disconnected' : rawStatus;
          })();
          console.log('[STATUS] Obs — initial fetch result:', normalizedStatus, 'for', targetId);
          updateStatusForUser(targetId, normalizedStatus);
        } else if (!cancelled) {
          console.log('[STATUS] Obs — initial fetch no data/error:', error?.message);
        }
      } catch {}

      // ── 2. Subscribe a postgres_changes (Realtime vía DB) ──
      const channel = supabase
        .channel(`user-status-${targetId}-${userId || 'anon'}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${targetId}`,
        }, (payload) => {
          if (!cancelled && payload.new.user_status !== undefined) {
            const updatedAt = payload.new.user_status_updated_at;
            const normalizedStatus = (() => {
              const rawStatus = payload.new.user_status;
              if (rawStatus === 'disconnected') return 'disconnected';
              if (!updatedAt) return rawStatus;
              const ageMs = Date.now() - new Date(updatedAt).getTime();
              return ageMs > STALE_STATUS_THRESHOLD_MS ? 'disconnected' : rawStatus;
            })();
            console.log('[STATUS] Obs — postgres_changes received:', normalizedStatus, '→ old:', payload.old?.user_status, 'for', targetId);
            updateStatusForUser(targetId, normalizedStatus);
          } else if (!cancelled) {
            console.log('[STATUS] Obs — postgres_changes but no user_status in payload');
          }
        })
        .subscribe((subStatus) => {
          console.log('[STATUS] Obs — subscribe status:', subStatus, 'for', targetId);
        });

      console.log('[STATUS] Obs — channel created + subscribed for', targetId);
      cleanupFns.push(() => {
        if (channel) supabase.removeChannel(channel);
      });

      // ── 3. Polling fallback cada 3s (no depende de Realtime) ──
      const pollStatus = async () => {
        if (cancelled) return;
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('user_status')
            .eq('id', targetId)
            .maybeSingle();
          if (!cancelled && !error && data?.user_status !== undefined) {
            const normalizedStatus = (() => {
              const rawStatus = data.user_status;
              const updatedAt = data.user_status_updated_at;
              if (rawStatus === 'disconnected') return 'disconnected';
              if (!updatedAt) return rawStatus;
              const ageMs = Date.now() - new Date(updatedAt).getTime();
              return ageMs > STALE_STATUS_THRESHOLD_MS ? 'disconnected' : rawStatus;
            })();
            updateStatusForUser(targetId, normalizedStatus);
          }
        } catch {}
      };
      const pollInterval = setInterval(pollStatus, 3000);
      const onVisible = () => { if (!document.hidden) pollStatus(); };
      document.addEventListener('visibilitychange', onVisible);
      cleanupFns.push(() => {
        clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', onVisible);
      });
    };

    Promise.all(normalizedIds.map(subscribeToUserStatus));

    return () => {
      cancelled = true;
      cleanupFns.forEach((cleanup) => cleanup());
      setStatuses({});
      setStatus(null);
    };
  }, [userId, otherUserId, checkMutualFollow]);

  return { status, statuses, myStatus, setMyStatus };
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
