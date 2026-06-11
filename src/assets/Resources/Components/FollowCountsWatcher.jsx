import { useEffect } from 'react';
import { supabase } from '../../services/supabaseclient';
import { useAuth } from '../../../hooks/useAuth';
import { getFollowCounts, setCachedFollowCounts } from '../../services/followService';

/**
 * Componente invisible que escucha cambios en la tabla `follows` via Realtime.
 * Cuando detecta un INSERT o DELETE donde el usuario actual es follower o followee,
 * refresca los counts y actualiza el cache en localStorage.
 *
 * Así, cuando Profile se monta (o ya está montado), siempre lee datos frescos del cache.
 */
export default function FollowCountsWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    const refreshCounts = async () => {
      try {
        const counts = await getFollowCounts(user.id);
        setCachedFollowCounts(user.id, counts);
      } catch (err) {
        console.warn('Error refreshing follow counts:', err);
      }
    };

    const channel = supabase
      .channel('follow-counts-watcher')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'follows',
          filter: `following_id=eq.${user.id}`,
        },
        () => {
          // Alguien siguió al usuario actual → refrescar seguidores
          refreshCounts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'follows',
          filter: `following_id=eq.${user.id}`,
        },
        () => {
          // Alguien dejó de seguir al usuario actual → refrescar seguidores
          refreshCounts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'follows',
          filter: `follower_id=eq.${user.id}`,
        },
        () => {
          // El usuario actual siguió a alguien → refrescar seguidos
          refreshCounts();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'follows',
          filter: `follower_id=eq.${user.id}`,
        },
        () => {
          // El usuario actual dejó de seguir → refrescar seguidos
          refreshCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
