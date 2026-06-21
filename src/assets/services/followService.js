import { supabase } from './supabaseclient';
import { clearVisibleIdsCache } from './postService';

/**
 * Follow a user and create a notification for them
 */
export async function followUser(followerId, followingId) {
  if (followerId === followingId) {
    throw new Error('No puedes seguirte a ti mismo');
  }

  const { data, error } = await supabase
    .from('follows')
    .insert({
      follower_id: followerId,
      following_id: followingId,
      status: 'accepted',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya sigues a este usuario');
    }
    console.error('Error following user:', error);
    throw error;
  }

  // Update cache
  setCachedFollowStatus(followerId, followingId, true);
  clearVisibleIdsCache(followerId);

  // Create a notification for the followed user
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: followingId,
      actor_id: followerId,
      type: 'follow',
      is_read: false,
    });

  if (notifError) {
    console.error('Error creating follow notification:', notifError);
  }

  return data;
}

/**
 * Send a follow request to a private profile
 */
export async function requestFollow(followerId, followingId) {
  if (followerId === followingId) {
    throw new Error('No puedes seguirte a ti mismo');
  }

  const { data, error } = await supabase
    .from('follows')
    .insert({
      follower_id: followerId,
      following_id: followingId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya enviaste una solicitud a este usuario');
    }
    console.error('Error sending follow request:', error);
    throw error;
  }

  // Create a follow_request notification for the profile owner
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: followingId,
      actor_id: followerId,
      type: 'follow_request',
      is_read: false,
    });

  if (notifError) {
    console.error('Error creating follow request notification:', notifError);
  }

  return data;
}

/**
 * Accept a follow request (from private profile owner)
 * Uses delete + re-insert instead of update to avoid RLS issues on UPDATE
 */
export async function acceptFollowRequest(requesterId, targetId) {
  // First delete the pending request (DELETE policy works — used by unfollowUser)
  const { error: delError } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', requesterId)
    .eq('following_id', targetId)
    .eq('status', 'pending');

  if (delError) {
    console.error('Error deleting pending request:', delError);
    throw delError;
  }

  // Then insert a new accepted follow (INSERT policy works — used by followUser)
  const { data, error: insError } = await supabase
    .from('follows')
    .insert({
      follower_id: requesterId,
      following_id: targetId,
      status: 'accepted',
    })
    .select()
    .single();

  if (insError) {
    console.error('Error inserting accepted follow:', insError);
    throw insError;
  }

  setCachedFollowStatus(requesterId, targetId, true);
  clearVisibleIdsCache(requesterId);
  clearVisibleIdsCache(targetId);

  // Notify the requester that their request was accepted
  console.log('Creating follow_request_accepted notification:', { user_id: requesterId, actor_id: targetId });
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: requesterId,
      actor_id: targetId,
      type: 'follow_request_accepted',
      is_read: false,
    });

  if (notifError) {
    console.error('Error creating accepted notification — posible problema de RLS:', notifError);
  }

  return data;
}

/**
 * Reject a follow request (from private profile owner)
 */
export async function rejectFollowRequest(requesterId, targetId) {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', requesterId)
    .eq('following_id', targetId)
    .eq('status', 'pending');

  if (error) {
    console.error('Error rejecting follow request:', error);
    throw error;
  }

  // Notify the requester that their request was rejected
  console.log('Creating follow_request_rejected notification:', { user_id: requesterId, actor_id: targetId });
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: requesterId,
      actor_id: targetId,
      type: 'follow_request_rejected',
      is_read: false,
    });

  if (notifError) {
    console.error('Error creating rejected notification — posible problema de RLS:', notifError);
  }
}

/**
 * Check if there's a pending follow request
 */
export async function hasPendingRequest(followerId, followingId) {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    console.error('Error checking pending request:', error);
    throw error;
  }

  return !!data;
}

/**
 * Cancel a pending follow request
 */
export async function cancelFollowRequest(followerId, followingId) {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .eq('status', 'pending');

  if (error) {
    console.error('Error cancelling follow request:', error);
    throw error;
  }
}

/**
 * Unfollow a user
 */
export async function unfollowUser(followerId, followingId) {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);

  if (error) {
    console.error('Error unfollowing user:', error);
    throw error;
  }

  // Update cache
  setCachedFollowStatus(followerId, followingId, false);
  clearVisibleIdsCache(followerId);
}

/**
 * Check if followerId follows followingId (usa cache)
 */
export async function isFollowing(followerId, followingId) {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .eq('status', 'accepted')
    .maybeSingle();

  if (error) {
    console.error('Error checking follow status:', error);
    throw error;
  }

  const status = !!data;
  // Actualizar cache con resultado fresco
  setCachedFollowStatus(followerId, followingId, status);
  return status;
}

/**
 * Get followers of a user (profiles that follow them)
 */
export async function getFollowers(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select(`
      follower_id,
      created_at,
      profiles!follows_follower_id_fkey (
        id,
        username,
        avatar_url,
        roles
      )
    `)
    .eq('following_id', userId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching followers:', error);
    throw error;
  }

  return data.map((item) => ({
    ...item.profiles,
    followed_since: item.created_at,
  }));
}

/**
 * Get users that a user is following
 */
export async function getFollowing(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select(`
      following_id,
      created_at,
      profiles!follows_following_id_fkey (
        id,
        username,
        avatar_url,
        roles
      )
    `)
    .eq('follower_id', userId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching following:', error);
    throw error;
  }

  return data.map((item) => ({
    ...item.profiles,
    followed_since: item.created_at,
  }));
}

/**
 * Get follow counts for a user
 */
export async function getFollowCounts(userId) {
  const [followersResult, followingResult] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', userId)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('follower_id', userId)
      .eq('status', 'accepted'),
  ]);

  const counts = {
    followers: followersResult.count ?? 0,
    following: followingResult.count ?? 0,
  };

  return counts;
}

// ── localStorage cache for explore data (profiles + counts) ──
const EXPLORE_CACHE_PREFIX = 'fc_explore_';
const EXPLORE_CACHE_TTL = 1000 * 60 * 10; // 10 min

export function setCachedExploreData(userId, data) {
  if (!data) return;
  try {
    const key = EXPLORE_CACHE_PREFIX + (userId || 'anon');
    const payload = { ts: Date.now(), ttl: EXPLORE_CACHE_TTL, data };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache explore data:', err);
  }
}

export function getCachedExploreData(userId) {
  try {
    const key = EXPLORE_CACHE_PREFIX + (userId || 'anon');
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || EXPLORE_CACHE_TTL)) {
      localStorage.removeItem(key);
      return null;
    }
    return payload.data || null;
  } catch (err) {
    console.warn('Could not read explore cache:', err);
    return null;
  }
}

// ── localStorage cache for follow status (isFollowing) ──
const FOLLOW_STATUS_PREFIX = 'fc_fs_';
const FOLLOW_STATUS_TTL = 1000 * 60 * 60; // 1 hour (misma duración que cache de perfil)

export function setCachedFollowStatus(followerId, targetId, status) {
  if (!followerId || !targetId) return;
  try {
    const key = `${FOLLOW_STATUS_PREFIX}${followerId}_${targetId}`;
    const payload = { ts: Date.now(), ttl: FOLLOW_STATUS_TTL, status };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache follow status:', err);
  }
}

export function getCachedFollowStatus(followerId, targetId) {
  if (!followerId || !targetId) return null;
  try {
    const key = `${FOLLOW_STATUS_PREFIX}${followerId}_${targetId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || FOLLOW_STATUS_TTL)) {
      localStorage.removeItem(key);
      return null;
    }
    return payload.status;
  } catch (err) {
    console.warn('Could not read cached follow status:', err);
    return null;
  }
}

// ── localStorage cache for follow counts ──
const COUNTS_CACHE_PREFIX = 'fc_counts_';
const COUNTS_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

export function setCachedFollowCounts(userId, counts) {
  if (!userId || !counts) return;
  try {
    const payload = { ts: Date.now(), ttl: COUNTS_CACHE_TTL, counts };
    localStorage.setItem(COUNTS_CACHE_PREFIX + userId, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache follow counts:', err);
  }
}

export function clearCachedFollowCounts(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(COUNTS_CACHE_PREFIX + userId);
  } catch (err) {
    console.warn('Could not clear cached follow counts:', err);
  }
}

export function getCachedFollowCounts(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(COUNTS_CACHE_PREFIX + userId);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || COUNTS_CACHE_TTL)) {
      localStorage.removeItem(COUNTS_CACHE_PREFIX + userId);
      return null;
    }
    return payload.counts || null;
  } catch (err) {
    console.warn('Could not read cached follow counts:', err);
    return null;
  }
}
