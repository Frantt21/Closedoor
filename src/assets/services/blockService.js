import { supabase } from './supabaseclient';

/**
 * Block a user
 * @param {string} blockerId - User performing the block
 * @param {string} blockedId - User to block
 * @returns {Promise<object>} - Block record
 */
export async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) {
    throw new Error('No puedes bloquearte a ti mismo');
  }

  const { data, error } = await supabase
    .from('blocks')
    .insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya has bloqueado a este usuario');
    }
    console.error('Error blocking user:', error);
    throw error;
  }

  return data;
}

/**
 * Unblock a user
 * @param {string} blockerId - User performing the unblock
 * @param {string} blockedId - User to unblock
 */
export async function unblockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) {
    console.error('Error unblocking user:', error);
    throw error;
  }
}

/**
 * Check if a user is blocked by the current user
 * @param {string} blockerId - Potential blocker
 * @param {string} blockedId - Potential blocked
 * @returns {Promise<boolean>} - True if blocked
 */
export async function isBlocked(blockerId, blockedId) {
  const { data, error } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
    .maybeSingle();

  if (error) {
    console.error('Error checking block status:', error);
    throw error;
  }

  return !!data;
}

/**
 * Get list of users blocked by the current user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - List of blocked user profiles
 */
export async function getBlockedUsers(userId) {
  const { data, error } = await supabase
    .from('blocks')
    .select(`
      blocked_id,
      created_at,
      profiles!blocks_blocked_id_fkey (
        id,
        username,
        avatar_url,
        roles
      )
    `)
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching blocked users:', error);
    throw error;
  }

  return data.map((item) => ({
    ...item.profiles,
    blocked_at: item.created_at,
  }));
}
