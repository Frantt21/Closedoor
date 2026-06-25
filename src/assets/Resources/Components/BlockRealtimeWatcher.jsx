import { useEffect } from 'react';
import { supabase } from '../../services/supabaseclient';
import { useAuth } from '../../../hooks/useAuth';
import { cacheBlockStatus } from '../../services/blockService';

/**
 * Componente invisible que escucha cambios en la tabla `blocks` via Realtime.
 * Siempre está montado (desde App.jsx) para actualizar el cache de bloqueo
 * sin importar en qué página esté el usuario.
 *
 * Cuando alguien bloquea/desbloquea al usuario actual, o cuando el usuario actual
 * bloquea/desbloquea a alguien desde otro dispositivo, el cache se actualiza
 * al instante y los componentes suscritos via subscribeBlockChanges() reaccionan.
 */
export default function BlockRealtimeWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('block-realtime-watcher')
      // ── Alguien me bloqueó ──
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'blocks', filter: `blocked_id=eq.${user.id}` },
        (payload) => {
          cacheBlockStatus(payload.new.blocker_id, user.id, true);
        }
      )
      // ── Alguien me desbloqueó ──
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'blocks', filter: `blocked_id=eq.${user.id}` },
        (payload) => {
          cacheBlockStatus(payload.old.blocker_id, user.id, false);
        }
      )
      // ── Yo bloqueé a alguien ──
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'blocks', filter: `blocker_id=eq.${user.id}` },
        (payload) => {
          cacheBlockStatus(user.id, payload.new.blocked_id, true);
        }
      )
      // ── Yo desbloqueé a alguien ──
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'blocks', filter: `blocker_id=eq.${user.id}` },
        (payload) => {
          cacheBlockStatus(user.id, payload.old.blocked_id, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
