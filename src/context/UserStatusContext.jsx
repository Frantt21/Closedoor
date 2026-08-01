import React, { createContext, useState, useEffect, useCallback, useRef, useContext } from 'react';
import { supabase } from '../assets/services/supabaseclient';

/**
 * UserStatusContext — Proveedor global de estados de usuario.
 *
 * Mantiene un mapa de userId → status que se actualiza mediante polling
 * cada 3s, independientemente de la ruta activa. Los componentes pueden
 * registrar usuarios para observación mediante useRegisterUserStatus().
 *
 * Separamos el contexto en dos para evitar loops infinitos:
 * - UserStatusActionsContext: funciones estables (register, unregister)
 * - UserStatusContext: estado volátil (statuses)
 */

const UserStatusActionsContext = createContext();
export const UserStatusContext = createContext();

// 1 minuto sin actualización → considerar disconnected
const STALE_STATUS_MS = 60 * 1000;
const POLL_INTERVAL_MS = 3000;

function computeEffectiveStatus(user) {
  if (!user?.user_status) return null;
  if (user.user_status === 'disconnected') return 'disconnected';
  if (!user.user_status_updated_at) return user.user_status;
  const ageMs = Date.now() - new Date(user.user_status_updated_at).getTime();
  return ageMs > STALE_STATUS_MS ? 'disconnected' : user.user_status;
}

export function UserStatusProvider({ children }) {
  const [statuses, setStatuses] = useState({});
  const registeredRef = useRef(new Set());
  const pollIntervalRef = useRef(null);

  // ── Funciones estables (nunca cambian) ──
  const register = useCallback((userIds) => {
    if (!userIds) return;
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    let changed = false;
    for (const id of ids) {
      if (id && !registeredRef.current.has(id)) {
        registeredRef.current.add(id);
        changed = true;
      }
    }
  }, []);

  const unregister = useCallback((userIds) => {
    if (!userIds) return;
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const id of ids) {
      if (id) {
        registeredRef.current.delete(id);
        setStatuses(prev => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }
  }, []);

  // ── Polling loop: cada 3s consulta todos los registrados ──
  const poll = useCallback(async () => {
    const ids = [...registeredRef.current];
    if (ids.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_status, user_status_updated_at')
        .in('id', ids);

      if (!error && data) {
        setStatuses(prev => {
          let changed = false;
          const next = { ...prev };
          for (const row of data) {
            const effective = computeEffectiveStatus(row);
            if (next[row.id] !== effective) {
              next[row.id] = effective;
              changed = true;
            }
          }
          // ⚠️ Perf: si ningún status cambió, devolver el MISMO objeto (prev)
          // para no disparar re-renders en todos los consumidores del contexto
          // cada 3s (el perfil se re-renderizaba entero en cada poll).
          return changed ? next : prev;
        });
      }
    } catch {}
  }, []);

  // Intervalo continuo (no depende de registrationVersion)
  useEffect(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    // Poll inicial
    poll();

    // Poll periódico
    pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Re-poll al volver al tab
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  return (
    <UserStatusActionsContext.Provider value={{ register, unregister }}>
      <UserStatusContext.Provider value={statuses}>
        {children}
      </UserStatusContext.Provider>
    </UserStatusActionsContext.Provider>
  );
}

/**
 * Hook para registrar un usuario en el observador global de estados.
 * Devuelve el estado actual del usuario (online/dnd/idle/disconnected/null).
 * El registro se limpia automáticamente al desmontar el componente.
 */
export function useRegisterUserStatus(userId) {
  const { register, unregister } = useContext(UserStatusActionsContext);
  const statuses = useContext(UserStatusContext);

  useEffect(() => {
    if (!userId) return;
    register(userId);
    return () => {
      unregister(userId);
    };
  }, [userId, register, unregister]);

  return userId ? statuses[userId] || null : null;
}

/**
 * Hook para registrar múltiples usuarios a la vez.
 * Útil en Chat.jsx para registrar todos los participantes de conversaciones.
 */
export function useRegisterMultipleUserStatus(userIds) {
  const { register, unregister } = useContext(UserStatusActionsContext);
  const prevIdsRef = useRef([]);

  useEffect(() => {
    const ids = (Array.isArray(userIds) ? userIds : []).filter(Boolean);
    const unique = [...new Set(ids)];

    // Registrar nuevos
    register(unique);

    // Desregistrar los que ya no están (por cambio de dependencias)
    const prev = prevIdsRef.current;
    const removed = prev.filter(id => !unique.includes(id));
    if (removed.length > 0) unregister(removed);

    prevIdsRef.current = unique;

    // Cleanup al desmontar
    return () => {
      unregister(unique);
    };
  }, [userIds, register, unregister]);
}
