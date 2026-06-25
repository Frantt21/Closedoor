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
 * Unfollow both ways (used when blocking).
 * Calls the unfollow_both_ways RPC to bypass RLS and delete follows in both directions.
 * @param {string} blockerId - User performing the block
 * @param {string} blockedId - User being blocked
 */
export async function unfollowBothWays(blockerId, blockedId) {
  const { error } = await supabase.rpc('unfollow_both_ways', {
    blocker_id: blockerId,
    blocked_id: blockedId,
  });

  if (error) {
    console.error('Error unfollowing both ways:', error);
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

// ── localStorage cache ──

const BLOCK_CACHE_PREFIX = 'fc_block_';

// ── Block change subscription (para que ProfileSidebar se entere de cambios) ──
let _blockChangeListeners = [];

/**
 * Subscribe to block status changes
 * @param {Function} fn - Callback when block status changes
 * @returns {Function} - Unsubscribe function
 */
export function subscribeBlockChanges(fn) {
  _blockChangeListeners.push(fn);
  return () => {
    _blockChangeListeners = _blockChangeListeners.filter(l => l !== fn);
  };
}

let _notifying = false;

function notifyBlockChanged() {
  if (_notifying) return; // Evita recursión infinita si un listener llama a cacheBlockStatus()
  _notifying = true;
  try {
    _blockChangeListeners.forEach(fn => fn());
  } finally {
    _notifying = false;
  }
}

/**
 * Cache a block status in localStorage
 * @param {string} blockerId - User who blocked
 * @param {string} blockedId - User who was blocked
 * @param {boolean} isBlocked - Whether the block exists
 * @param {boolean} [skipNotify=false] - If true, skip notifying subscribers (prevents loops)
 */
export function cacheBlockStatus(blockerId, blockedId, isBlocked, skipNotify = false) {
  try {
    const key = BLOCK_CACHE_PREFIX + blockerId + '_' + blockedId;
    localStorage.setItem(key, isBlocked ? '1' : '0');
    if (!skipNotify) {
      notifyBlockChanged();
    }
  } catch {}
}

/**
 * Read cached block status from localStorage
 * @param {string} blockerId - Potential blocker
 * @param {string} blockedId - Potential blocked
 * @returns {boolean|null} - true/false if cached, null if no cache
 */
export function getCachedBlockStatus(blockerId, blockedId) {
  try {
    const key = BLOCK_CACHE_PREFIX + blockerId + '_' + blockedId;
    const val = localStorage.getItem(key);
    if (val === '1') return true;
    if (val === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove cached block status
 * @param {string} blockerId 
 * @param {string} blockedId 
 */
export function clearCachedBlockStatus(blockerId, blockedId) {
  try {
    const key = BLOCK_CACHE_PREFIX + blockerId + '_' + blockedId;
    localStorage.removeItem(key);
  } catch {}
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

/**
 * Get list of users who have blocked the current user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - List of user profiles who blocked me
 */
export async function getUsersWhoBlockedMe(userId) {
  const { data, error } = await supabase
    .from('blocks')
    .select(`
      blocker_id,
      created_at,
      profiles!blocks_blocker_id_fkey (
        id,
        username,
        avatar_url,
        roles
      )
    `)
    .eq('blocked_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching users who blocked me:', error);
    throw error;
  }

  return data.map((item) => ({
    ...item.profiles,
    blocked_at: item.created_at,
  }));
}

// ── Cached ID lists con TTL de 5 minutos ──

const BLOCKED_IDS_CACHE_PREFIX = 'fc_blocked_ids_';
const BLOCKED_ME_IDS_CACHE_PREFIX = 'fc_blocked_me_ids_';
const BLOCKED_LISTS_TTL = 1000 * 60 * 5; // 5 minutos

function setCachedBlockedIds(userId, ids) {
  try {
    const key = BLOCKED_IDS_CACHE_PREFIX + userId;
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl: BLOCKED_LISTS_TTL, ids }));
  } catch {}
}

function getCachedBlockedIds(userId) {
  try {
    const raw = localStorage.getItem(BLOCKED_IDS_CACHE_PREFIX + userId);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - p.ts > (p.ttl || BLOCKED_LISTS_TTL)) {
      localStorage.removeItem(BLOCKED_IDS_CACHE_PREFIX + userId);
      return null;
    }
    return p.ids || null;
  } catch { return null; }
}

function setCachedBlockedMeIds(userId, ids) {
  try {
    const key = BLOCKED_ME_IDS_CACHE_PREFIX + userId;
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl: BLOCKED_LISTS_TTL, ids }));
  } catch {}
}

function getCachedBlockedMeIds(userId) {
  try {
    const raw = localStorage.getItem(BLOCKED_ME_IDS_CACHE_PREFIX + userId);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Date.now() - p.ts > (p.ttl || BLOCKED_LISTS_TTL)) {
      localStorage.removeItem(BLOCKED_ME_IDS_CACHE_PREFIX + userId);
      return null;
    }
    return p.ids || null;
  } catch { return null; }
}

export function clearBlockedListsCache(userId) {
  try {
    localStorage.removeItem(BLOCKED_IDS_CACHE_PREFIX + userId);
    localStorage.removeItem(BLOCKED_ME_IDS_CACHE_PREFIX + userId);
  } catch {}
}

/**
 * Obtiene IDs de usuarios bloqueados por mí, con cache de 5 min + background refresh.
 * Retorna inmediatamente el cache si existe, o hace fetch si no.
 * Siempre refresca en background para mantener datos frescos.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getBlockedUserIds(userId) {
  // Intentar cache primero
  const cached = getCachedBlockedIds(userId);
  if (cached !== null) {
    // Background refresh: actualiza el cache sin esperar
    getBlockedUsers(userId)
      .then(profiles => setCachedBlockedIds(userId, profiles.map(p => p.id)))
      .catch(() => {});
    return cached;
  }
  // Cache miss: fetch fresh
  const profiles = await getBlockedUsers(userId);
  const ids = profiles.map(p => p.id);
  setCachedBlockedIds(userId, ids);
  return ids;
}

/**
 * Obtiene IDs de usuarios que me bloquearon, con cache de 5 min + background refresh.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getUsersWhoBlockedMeIds(userId) {
  const cached = getCachedBlockedMeIds(userId);
  if (cached !== null) {
    // Background refresh
    getUsersWhoBlockedMe(userId)
      .then(profiles => setCachedBlockedMeIds(userId, profiles.map(p => p.id)))
      .catch(() => {});
    return cached;
  }
  const profiles = await getUsersWhoBlockedMe(userId);
  const ids = profiles.map(p => p.id);
  setCachedBlockedMeIds(userId, ids);
  return ids;
}
