import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseclient';
import { getCachedFollowStatus } from './followService';
import { updateTrackedStatus } from './presenceService';

/**
 * useUserStatus — Hook para manejar el estado online/dnd/idle/disconnected
 * del usuario actual y suscribirse al estado de otros usuarios.
 *
 * Mecanismos de sincronización (3 capas):
 * 1. ⭐ Presence (Supabase Realtime) — instantáneo, detecta desconexión automáticamente
 * 2. ⭐ DB polling cada 3s — fallback para usuarios sin Presence
 * 3. ⭐ Staleness check — corrige estados obsoletos por tiempo en `user_status_updated_at`
 *
 * @param {string} userId — ID del usuario actual
 * @param {string} otherUserId — ID del usuario a observar
 * @param {boolean} checkMutualFollow — Si true, solo muestra status si hay follow mutuo
 * @returns {{ status: string|null, statuses: object, myStatus: string, setMyStatus: fn }}
 */
export function useUserStatus(userId, otherUserId, checkMutualFollow = false) {
  const [status, setStatus] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [myStatus, setMyStatusState] = useState('online');
  const myStatusRef = useRef('online');
  const sessionTokenRef = useRef(null);
  const mountedCleanupRef = useRef(null);
  const lastObservedTargetKeyRef = useRef('');
  const STALE_STATUS_THRESHOLD_MS = 60 * 1000; // 1 minuto — detecta desconexión más rápido

  const persistPresence = useCallback(async (newStatus) => {
    if (!userId) return null;

    try {
      const payload = {
        user_status: newStatus,
        user_status_updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', userId);

      if (error) console.warn('[STATUS] DB update error:', error);
      else console.log('[STATUS] DB updated OK →', newStatus);
      return newStatus;
    } catch (err) {
      console.warn('[STATUS] Error updating user_status:', err);
      return newStatus;
    }
  }, [userId]);

  // ── Actualizar mi estado (DB + Presence + secureStorage) ──
  const setMyStatus = useCallback(async (newStatus) => {
    if (!userId) { console.log('[STATUS] setMyStatus skipped — no userId'); return; }
    if (!['online', 'dnd', 'idle', 'disconnected'].includes(newStatus)) return;

    console.log('[STATUS] setMyStatus →', newStatus);

    myStatusRef.current = newStatus;
    setMyStatusState(newStatus);

    // 1. Guardar en secureStorage
    try {
      const { setItem } = await import('./secureStorage');
      setItem('fc_user_status', newStatus);
    } catch {}

    // 2. Actualizar Presence (instantáneo, real-time)
    updateTrackedStatus(newStatus);

    // 3. Persistir en DB (fallback legacy)
    await persistPresence(newStatus);
  }, [persistPresence, userId]);

  // ── Inicializar estado al montar ──
  useEffect(() => {
    if (!userId) return;

    (async () => {
      let initialStatus = 'online';
      try {
        const { getItem } = await import('./secureStorage');
        const saved = getItem('fc_user_status');
        console.log('[STATUS] Mount — saved:', saved);
        if (saved === 'dnd' || saved === 'idle') {
          initialStatus = saved;
        }
      } catch {}

      console.log('[STATUS] Mount — initialStatus:', initialStatus);
      myStatusRef.current = initialStatus;
      setMyStatusState(initialStatus);

      // ── Setup session token ──
      let authSubscription = null;
      if (typeof supabase?.auth?.getSession === 'function') {
        supabase.auth.getSession().then(({ data } = {}) => {
          sessionTokenRef.current = data?.session?.access_token || null;
        }).catch(() => {});
      }
      if (typeof supabase?.auth?.onAuthStateChange === 'function') {
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          sessionTokenRef.current = session?.access_token || null;
        });
        authSubscription = data?.subscription || null;
      }

      // ── Heartbeat cada 30s ──
      const heartbeatRef = { current: null };
      const startHeartbeat = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          const s = myStatusRef.current;
          if (s === 'online' || s === 'idle' || s === 'dnd') {
            persistPresence(s).catch(() => {});
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

        // 1. DB vía fetch con keepalive: true — garantiza que llegue aunque
        //    el navegador cierre la pestaña
        const token = sessionTokenRef.current;
        if (SB_URL && SB_KEY && token) {
          try {
            fetch(`${restOrigin}/rest/v1/profiles?id=eq.${userId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'apikey': SB_KEY,
              },
              body: JSON.stringify({
                user_status: 'disconnected',
                user_status_updated_at: new Date().toISOString(),
              }),
              keepalive: true,
            }).catch(() => {});
          } catch {}
        }

        // 2. Fallback persistPresence
        persistPresence('disconnected').catch(() => {});

        // NOTA: NO llamar a updateTrackedStatus aquí. El channel.track() durante
        // beforeunload puede dejar al usuario atascado en el canal Presence con
        // el último estado, impidiendo que otros clientes detecten la desconexión.
      };
      window.addEventListener('beforeunload', handleDisconnect);
      window.addEventListener('pagehide', handleDisconnect);

      mountedCleanupRef.current = () => {
        window.removeEventListener('beforeunload', handleDisconnect);
        window.removeEventListener('pagehide', handleDisconnect);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        authSubscription?.unsubscribe?.();
      };

      // Sync inicial con la DB
      console.log('[STATUS] Mount — syncing DB with:', initialStatus);
      persistPresence(initialStatus).catch(() => {});
    })();

    return () => {
      if (mountedCleanupRef.current) {
        mountedCleanupRef.current();
        mountedCleanupRef.current = null;
      }
    };
  }, [userId, setMyStatus]);

  // ── Suscribirse al estado de otro usuario ──
  // Capa 1: Presence (Supabase Realtime) — instantáneo, detecta desconexión
  // Capa 2: DB polling cada 3s — fallback para usuarios sin Presence
  useEffect(() => {
    const targetIds = (Array.isArray(otherUserId) ? otherUserId : [otherUserId]).filter(Boolean);
    const isMultiTarget = Array.isArray(otherUserId);

    if (targetIds.length === 0) {
      setStatus(null);
      setStatuses({});
      return;
    }

    const normalizedIds = [...new Set(targetIds)];
    const targetKey = normalizedIds.join('|');
    const targetsChanged = lastObservedTargetKeyRef.current !== targetKey;

    if (targetsChanged) {
      setStatus(null);
      // NO resetear statuses — evita el parpadeo. Los valores viejos persisten
      // hasta que Presence sync o el DB poll los actualice.
    }
    lastObservedTargetKeyRef.current = targetKey;

    let cancelled = false;
    const cleanupFns = [];

    const updateStatusForUser = (targetId, value) => {
      if (cancelled) return;
      if (isMultiTarget) {
        setStatuses(prev => {
          if (prev[targetId] === value) return prev;
          console.log('[STATUS] setStatuses', targetId.slice(0,8), prev[targetId] || '∅', '→', value);
          return { ...prev, [targetId]: value };
        });
      } else {
        console.log('[STATUS] setStatus', '→', value);
        setStatus(value);
      }
    };

    // NOTA: No usar Presence para observar estados de otros usuarios.
    // Presence es ÚNICAMENTE para que el usuario actual emita su estado.
    // El servidor Presence puede mantener usuarios atascados en el canal
    // incluso después de desconectarse (especialmente si se llamó a
    // updateTrackedStatus durante beforeunload), causando un ciclo
    // infinito de override entre Presence y DB poll.
    //
    // DB polling cada 3s es la ÚNICA fuente de verdad para observar.
    // El keepalive fetch en beforeunload garantiza que la DB tenga
    // el estado correcto al cerrar la pestaña.

    // ── Capa 2: DB polling (fallback) ──
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

      // ── Fetch inicial desde DB ──
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_status, user_status_updated_at')
          .eq('id', targetId)
          .maybeSingle();

        if (!cancelled && !error && data?.user_status !== undefined) {
          const normalizedStatus = (() => {
            const rawStatus = data.user_status;
            if (rawStatus === 'disconnected') return 'disconnected';
            const updatedAt = data.user_status_updated_at;
            if (!updatedAt) return rawStatus;
            const ageMs = Date.now() - new Date(updatedAt).getTime();
            return ageMs > STALE_STATUS_THRESHOLD_MS ? 'disconnected' : rawStatus;
          })();
          console.log('[STATUS] Obs — initial fetch result:', normalizedStatus, 'for', targetId);
          updateStatusForUser(targetId, normalizedStatus);
        }
      } catch {}

      // ── Polling cada 3s ──
      // La DB es la ÚNICA fuente de verdad. No se usa Presence para observar
      // porque el servidor Presence puede mantener usuarios atascados en el
      // canal después de desconectarse, causando ciclos de override.
      const pollStatus = async () => {
        if (cancelled) return;

        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('user_status, user_status_updated_at')
            .eq('id', targetId)
            .maybeSingle();
          if (!cancelled && !error && data?.user_status !== undefined) {
            const rawStatus = data.user_status;
            // Aplicar stale check para estados no-disconnected
            let effectiveStatus = rawStatus;
            if (rawStatus !== 'disconnected') {
              const updatedAt = data.user_status_updated_at;
              if (updatedAt) {
                const ageMs = Date.now() - new Date(updatedAt).getTime();
                if (ageMs > STALE_STATUS_THRESHOLD_MS) {
                  effectiveStatus = 'disconnected';
                }
              }
            }
            console.log('[STATUS] POLL', targetId.slice(0,8), 'DB:', rawStatus, '→ effective:', effectiveStatus);
            updateStatusForUser(targetId, effectiveStatus);
          }
        } catch {}
      };
      void pollStatus();
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
      if (lastObservedTargetKeyRef.current === targetKey) {
        lastObservedTargetKeyRef.current = '';
      }
      // NO resetear statuses aquí — evita que al cambiar de targets
      // (por ejemplo al cambiar de chat) se borren los estados y parpadeen.
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
