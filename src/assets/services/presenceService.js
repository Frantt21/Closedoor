import { supabase } from './supabaseclient';
import { getItem } from './secureStorage';

/**
 * presenceService — Gestor global de Presence vía Supabase Realtime.
 *
 * Cómo funciona:
 * - Un único canal `global-presence` es compartido por toda la app.
 * - Cada cliente autenticado hace track de { user_id, user_status, online_at }.
 * - Presence detecta automáticamente desconexiones (cierre de pestaña, mobile, etc.)
 *   con un timeout de ~10s del servidor.
 * - Los hooks/componentes se suscriben con subscribePresence() y reciben
 *   el estado completo actualizado en cada sync.
 *
 * Lifecycle:
 *   initPresence(userId, status) → llamado desde AuthContext al iniciar sesión
 *   updateTrackedStatus(newStatus) → llamado desde setMyStatus del hook
 *   disposePresence() → llamado desde AuthContext al cerrar sesión
 *   subscribePresence(listener) → usado por hooks para recibir actualizaciones
 */

let channel = null;
let allPresences = {}; // { [userId]: { user_id, user_status, online_at } }
const listeners = new Set();
let currentUserId = null;

function notifyListeners() {
  const snapshot = { ...allPresences };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Inicializa el canal de Presence.
 * Solo crea el canal una vez (singleton). Llamar desde AuthContext
 * cuando el usuario inicia sesión.
 *
 * Lee automáticamente el estado guardado en secureStorage (fc_user_status)
 * para que al reconectar se restaure DND/idle en lugar de mostrar 'online'.
 *
 * @param {string} userId — ID del usuario actual
 * @param {string} [status] — Estado por defecto si no hay saved status
 */
export function initPresence(userId, status = 'online') {
  if (!userId || channel) return;

  currentUserId = userId;

  // ── Restaurar estado guardado en secureStorage ──
  let effectiveStatus = status;
  try {
    const saved = getItem('fc_user_status');
    if (saved === 'dnd' || saved === 'idle') {
      effectiveStatus = saved;
    }
  } catch {
    // secureStorage puede no estar disponible
  }

  console.log('[PRESENCE] init — restored status:', effectiveStatus);

  if (typeof supabase?.channel !== 'function') {
    console.warn('[PRESENCE] supabase.channel not available');
    return;
  }

  channel = supabase.channel('global-presence');

  channel
    .on('presence', { event: 'sync' }, () => {
      if (!channel) return;
      const state = channel.presenceState();
      const newPresences = {};
      for (const userPresences of Object.values(state)) {
        for (const p of userPresences) {
          if (p.user_id) {
            newPresences[p.user_id] = p;
          }
        }
      }
      allPresences = newPresences;
      notifyListeners();
    })
    .subscribe(async (subStatus) => {
      if (subStatus === 'SUBSCRIBED') {
        try {
          await channel.track({
            user_id: userId,
            user_status: effectiveStatus,
            online_at: new Date().toISOString(),
          });
          console.log('[PRESENCE] Tracked as:', effectiveStatus);
        } catch (err) {
          console.warn('[PRESENCE] Track error:', err);
        }
      }
    });
}

/**
 * Actualiza el estado del usuario actual en el canal de Presence.
 * Llamar desde setMyStatus.
 *
 * @param {string} newStatus
 */
export function updateTrackedStatus(newStatus) {
  if (!channel || !currentUserId) return;
  channel
    .track({
      user_id: currentUserId,
      user_status: newStatus,
      online_at: new Date().toISOString(),
    })
    .catch(() => {});
}

/**
 * Suscribe un listener a los cambios de Presence.
 * El listener recibe inmediatamente el estado actual si hay datos.
 *
 * @param {(presences: Object) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribePresence(listener) {
  listeners.add(listener);

  // Si ya hay presencias cargadas, notificar inmediatamente
  if (Object.keys(allPresences).length > 0) {
    try {
      listener({ ...allPresences });
    } catch {
      /* ignore */
    }
  }

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Obtiene el estado de Presence de un usuario específico,
 * o de todos los usuarios presentes.
 *
 * @param {string} [userId]
 * @returns {object|null}
 */
export function getPresence(userId) {
  return userId ? allPresences[userId] || null : { ...allPresences };
}

/**
 * Libera el canal de Presence. Llamar desde AuthContext al cerrar sesión.
 */
export function disposePresence() {
  if (channel) {
    channel.unsubscribe();
    channel = null;
  }
  allPresences = {};
  listeners.clear();
  currentUserId = null;
}
