import { supabase } from './supabaseclient';

// ── POSTS ──

/**
 * Build mentions mapping from content: { user_id: "username_at_post_time" }
 */
export async function resolveMentions(content) {
  if (!content) return {};
  const usernames = extractMentions(content);
  if (!usernames.length) return {};
  const users = await getMentionUserIds(usernames);
  const mentions = {};
  for (const u of users) {
    mentions[u.id] = u.username;
  }
  return mentions;
}

export async function createPost({ userId, content, imageUrl, imageUrls, videoUrl }) {
  let mentions = {};
  if (content) {
    try {
      mentions = await resolveMentions(content);
    } catch (e) {
      console.warn('Error resolving mentions:', e);
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: userId,
      content,
      image_url: imageUrl || null,
      image_urls: imageUrls && imageUrls.length > 0 ? imageUrls : null,
      video_url: videoUrl || null,
      mentions,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Error creating post:', error);
    throw error;
  }
  return data;
}

export async function getPosts({ userId, profileUserId, limit = 20, offset = 0 } = {}) {
  let query = supabase      .from('posts')
    .select('*, profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)');

  if (profileUserId) {
    query = query
      .eq('user_id', profileUserId)
      .order('is_pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nulls_first: false })
      .order('created_at', { ascending: false });
  } else if (userId) {
    query = query.eq('user_id', userId).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching posts:', error);
    throw error;
  }
  return data || [];
}

export async function getPost(postId) {
  const { data, error } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)')
    .eq('id', postId)
    .single();

  if (error) {
    console.error('Error fetching post:', error);
    throw error;
  }
  return data;
}

export async function updatePost(postId, updates) {
  const finalUpdates = { ...updates, updated_at: new Date().toISOString() };

  // Re-resolve mentions if content changed
  if (updates.content) {
    try {
      finalUpdates.mentions = await resolveMentions(updates.content);
    } catch (e) {
      console.warn('Error resolving mentions on update:', e);
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .update(finalUpdates)
    .eq('id', postId)
    .select()
    .single();

  if (error) {
    console.error('Error updating post:', error);
    throw error;
  }
  return data;
}

export async function deletePost(postId) {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) {
    console.error('Error deleting post:', error);
    throw error;
  }
}

const MAX_PINNED = 3;

export async function togglePinPost(postId, userId, currentPinned) {
  if (!currentPinned) {
    // Verificar límite de posts fijados
    const { count, error } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_pinned', true);

    if (error) {
      console.error('Error checking pinned count:', error);
      throw error;
    }

    if (count >= MAX_PINNED) {
      throw new Error(`Límite de ${MAX_PINNED} posts fijados alcanzado. Desfija uno antes de fijar otro.`);
    }
  }

  return updatePost(postId, {
    is_pinned: !currentPinned,
    pinned_at: !currentPinned ? new Date().toISOString() : null,
  });
}

// ── PROFILE CONTENT (posts + reposts) ──

export async function getProfileContent(profileUserId, currentUserId) {
  if (!profileUserId) return [];

  const [posts, repostsResult] = await Promise.all([
    getPosts({ profileUserId }),
    supabase
      .from('reposts')
      .select(`
        id, created_at, user_id,
        posts!reposts_post_id_fkey (
          id, user_id, content, image_url, image_urls, video_url, is_pinned, pinned_at, mentions,
          likes_count, comments_count, reposts_count, views_count, created_at, updated_at,
          profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)
        )
      `)
      .eq('user_id', profileUserId)
      .order('created_at', { ascending: false }),
  ]);

  const repostItems = (repostsResult.data || []).map((r) => ({
    ...r.posts,
    is_pinned: false,  // Los reposts nunca heredan el pin del post original
    pinned_at: null,
    _repostInfo: {
      repostId: r.id,
      repostedAt: r.created_at,
    },
  }));

  // Fijar is_private en los posts originales que vienen de reposts
  // (ya que la join del repost trae profiles del post original)
  for (const item of repostItems) {
    if (item.profiles && !('is_private' in item.profiles)) {
      item.profiles.is_private = item.profiles.is_private ?? false;
    }
  }

  // Deduplicar por post.id: si el usuario reposteó su propio post, evitar duplicado
  const seenIds = new Set();
  const merged = [...posts];
  posts.forEach((p) => seenIds.add(p.id));
  for (const item of repostItems) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      merged.push(item);
    }
  }
  merged.sort(sortProfilePosts);
  return merged;
}

// ── Cache de IDs visibles (para evitar consultas repetidas a follows/profiles) ──
const VISIBLE_IDS_PREFIX = 'fc_vis_';
const VISIBLE_IDS_TTL = 1000 * 60 * 2; // 2 minutos

function setCachedVisibleIds(userId, ids) {
  if (!ids) return;
  try {
    const key = VISIBLE_IDS_PREFIX + (userId || 'anon');
    const payload = { ts: Date.now(), ttl: VISIBLE_IDS_TTL, ids };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache visible IDs:', err);
  }
}

function getCachedVisibleIds(userId) {
  try {
    const key = VISIBLE_IDS_PREFIX + (userId || 'anon');
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || VISIBLE_IDS_TTL)) {
      localStorage.removeItem(key);
      return null;
    }
    return payload.ids || null;
  } catch (err) {
    return null;
  }
}

/**
 * Invalidar cache de IDs visibles (llamado desde followService cuando
 * el usuario sigue/deja de seguir)
 */
export function clearVisibleIdsCache(userId) {
  try {
    const key = VISIBLE_IDS_PREFIX + (userId || 'anon');
    localStorage.removeItem(key);
  } catch (err) {
    /* ignore */
  }
}

/**
 * Fetch visible user IDs desde Supabase (seguidos + públicos)
 */
async function fetchVisibleIds(userId) {
  const visibleIds = new Set();

  if (userId) {
    visibleIds.add(userId);

    const [followingResult, publicResult] = await Promise.all([
      supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .eq('status', 'accepted'),
      supabase
        .from('profiles')
        .select('id')
        .or('is_private.is.null,is_private.eq.false'),
    ]);

    (followingResult.data || []).forEach(f => visibleIds.add(f.following_id));
    (publicResult.data || []).forEach(p => visibleIds.add(p.id));
  } else {
    const { data: publicUsers } = await supabase
      .from('profiles')
      .select('id')
      .or('is_private.is.null,is_private.eq.false');
    (publicUsers || []).forEach(p => visibleIds.add(p.id));
  }

  const ids = [...visibleIds];
  setCachedVisibleIds(userId, ids);
  return ids;
}

/**
 * Refrescar IDs visibles en background y actualizar cache
 */
async function refreshVisibleIds(userId) {
  try {
    await fetchVisibleIds(userId);
  } catch (err) {
    console.warn('Error refreshing visible IDs:', err);
  }
}

// ── FEED (filtrando perfiles privados, con cache de IDs visibles) ──

export async function getFeed({ limit = 20, offset = 0, userId } = {}) {
  let query = supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)');

  // Resolver IDs visibles con cache (o fetch si cache miss)
  let visibleIdsArray = getCachedVisibleIds(userId);
  const fromCache = !!visibleIdsArray;

  if (!visibleIdsArray) {
    visibleIdsArray = await fetchVisibleIds(userId);
  }

  if (visibleIdsArray.length > 0) {
    query = query.in('user_id', visibleIdsArray);
  } else {
    return [];
  }

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching feed:', error);
    throw error;
  }
  const posts = data || [];

  // Si vino de cache, refrescar IDs en background (sin await)
  if (fromCache && userId) {
    refreshVisibleIds(userId);
  }

  return posts;
}

// ── LIKES ──

export async function likePost(postId, userId) {
  const { error } = await supabase
    .from('likes')
    .insert({ user_id: userId, post_id: postId });

  if (error && error.code !== '23505') {
    console.error('Error liking post:', error);
    throw error;
  }
}

export async function unlikePost(postId, userId) {
  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId);

  if (error) {
    console.error('Error unliking post:', error);
    throw error;
  }
}

export async function isLiked(postId, userId) {
  if (!userId || !postId) return false;
  const { data, error } = await supabase
    .from('likes')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function getLikedPostIds(postIds, userId) {
  if (!userId || !postIds.length) return [];
  const { data, error } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error) return [];
  return (data || []).map((l) => l.post_id);
}

export async function getRepostedPostIds(postIds, userId) {
  if (!userId || !postIds.length) return [];
  const { data, error } = await supabase
    .from('reposts')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error) return [];
  return (data || []).map((r) => r.post_id);
}

// ── COMMENTS ──

export async function createComment({ postId, userId, content, parentId = null, imageUrl = null, videoUrl = null }) {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      user_id: userId,
      post_id: postId,
      content,
      parent_id: parentId,
      image_url: imageUrl,
      video_url: videoUrl,
    })
    .select('*, profiles!comments_user_id_fkey (id, username, avatar_url, roles)')
    .single();

  if (error) {
    console.error('Error creating comment:', error);
    throw error;
  }

  return data;
}

export async function getComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, profiles!comments_user_id_fkey (id, username, avatar_url, roles)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching comments:', error);
    throw error;
  }
  return data || [];
}

export async function deleteComment(commentId) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) {
    console.error('Error deleting comment:', error);
    throw error;
  }
}

export async function updateComment(commentId, content) {
  const { data, error } = await supabase
    .from('comments')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .select()
    .single();

  if (error) {
    console.error('Error updating comment:', error);
    throw error;
  }
  return data;
}

// ── COMMENT LIKES ──

export async function likeComment(commentId, userId) {
  const { error } = await supabase
    .from('comment_likes')
    .insert({ user_id: userId, comment_id: commentId });

  if (error && error.code !== '23505') {
    console.error('Error liking comment:', error);
    throw error;
  }
}

export async function unlikeComment(commentId, userId) {
  const { error } = await supabase
    .from('comment_likes')
    .delete()
    .eq('user_id', userId)
    .eq('comment_id', commentId);

  if (error) {
    console.error('Error unliking comment:', error);
    throw error;
  }
}

export async function isCommentLiked(commentId, userId) {
  if (!userId || !commentId) return false;
  const { data, error } = await supabase
    .from('comment_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('comment_id', commentId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function getCommentLikesCount(commentId) {
  const { count, error } = await supabase
    .from('comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);

  if (error) return 0;
  return count || 0;
}

// ── REPOSTS ──

export async function repostPost(postId, userId) {
  // Verificar si el post pertenece a un perfil privado
  // Si es privado y quien repostea NO es el dueño del post, bloquear
  const { data: post } = await supabase
    .from('posts')
    .select('user_id, profiles!posts_user_id_fkey (is_private)')
    .eq('id', postId)
    .single();

  if (post) {
    const isPrivate = post.profiles?.is_private === true;
    const isOwner = post.user_id === userId;
    if (isPrivate && !isOwner) {
      throw new Error('repost_private_forbidden');
    }
  }

  const { error } = await supabase
    .from('reposts')
    .insert({ user_id: userId, post_id: postId });

  if (error && error.code !== '23505') {
    console.error('Error reposting:', error);
    throw error;
  }
}

export async function unrepostPost(postId, userId) {
  const { error } = await supabase
    .from('reposts')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId);

  if (error) {
    console.error('Error removing repost:', error);
    throw error;
  }
}

export async function isReposted(postId, userId) {
  if (!userId || !postId) return false;
  const { data, error } = await supabase
    .from('reposts')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

// ── VIEWS ──

const VIEWED_POSTS_KEY = 'fc_viewed_';

/**
 * Track a post view (once per user per post, dedup via localStorage)
 * Increments views_count on the post if not already viewed
 */
export async function trackPostView(postId, userId) {
  if (!postId) return false;
  const key = VIEWED_POSTS_KEY + (userId || 'anon');
  try {
    const raw = localStorage.getItem(key);
    const viewed = raw ? JSON.parse(raw) : [];
    if (viewed.includes(postId)) return false; // Already viewed

    // Increment views_count on the post
    const { data: post } = await supabase
      .from('posts')
      .select('views_count')
      .eq('id', postId)
      .single();

    if (post) {
      await supabase
        .from('posts')
        .update({ views_count: (post.views_count || 0) + 1 })
        .eq('id', postId);
    }

    // Add to viewed set
    viewed.push(postId);
    localStorage.setItem(key, JSON.stringify(viewed));
    return true;
  } catch (err) {
    console.warn('Error tracking view:', err);
    return false;
  }
}

// ── SAVED POSTS ──

export async function savePost(postId, userId) {
  const { error } = await supabase
    .from('saved_posts')
    .insert({ user_id: userId, post_id: postId });

  if (error && error.code !== '23505') {
    console.error('Error saving post:', error);
    throw error;
  }
}

export async function unsavePost(postId, userId) {
  const { error } = await supabase
    .from('saved_posts')
    .delete()
    .eq('user_id', userId)
    .eq('post_id', postId);

  if (error) {
    console.error('Error unsaving post:', error);
    throw error;
  }
}

export async function isSaved(postId, userId) {
  if (!userId || !postId) return false;
  const { data, error } = await supabase
    .from('saved_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();

  if (error) return false;
  return !!data;
}

export async function getSavedPostIds(postIds, userId) {
  if (!userId || !postIds.length) return [];
  const { data, error } = await supabase
    .from('saved_posts')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);

  if (error) return [];
  return (data || []).map((s) => s.post_id);
}

export async function getSavedPosts(userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('saved_posts')
    .select(`
      id, created_at,
      posts!saved_posts_post_id_fkey (
        id, user_id, content, image_url, image_urls, video_url, mentions,          likes_count, comments_count, reposts_count, views_count, created_at, updated_at,
        profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Error fetching saved posts:', error);
    throw error;
  }

  return (data || []).map((s) => ({
    ...s.posts,
    _savedInfo: { savedId: s.id, savedAt: s.created_at },
  }));
}

// ── @MENTIONS ──

const MENTION_REGEX = /(?<![\w@])@([a-zA-Z0-9_]+)/g;

/**
 * Extract @mentions from text content
 */
export function extractMentions(content) {
  if (!content) return [];
  const mentions = [];
  let match;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const username = match[1].toLowerCase();
    if (!mentions.includes(username)) {
      mentions.push(username);
    }
  }
  return mentions;
}

/**
 * Look up user IDs by usernames for @mentions
 */
export async function getMentionUserIds(usernames) {
  if (!usernames.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .in('username', usernames);

  if (error) {
    console.error('Error looking up mention users:', error);
    return [];
  }
  return data || [];
}

/**
 * Create mention notifications for each mentioned user
 */
export async function notifyMentions(actorId, postId, content) {
  const usernames = extractMentions(content);
  if (!usernames.length) return;

  const mentionedUsers = await getMentionUserIds(usernames);
  if (!mentionedUsers.length) return;

  // Only notify users that are not the actor themselves
  const notifications = mentionedUsers
    .filter((u) => u.id !== actorId)
    .map((u) => ({
      actor_id: actorId,
      user_id: u.id,
      type: 'mention',
      reference_id: postId,
    }));

  if (!notifications.length) return;

  const { error } = await supabase.from('notifications').insert(notifications);
  if (error) {
    console.error('Error creating mention notifications:', error);
  }
}

// ── CACHE ──
const POST_CACHE_PREFIX = 'fc_post_';
const POST_CACHE_TTL = 1000 * 60 * 2; // 2 min

export function setCachedPost(post) {
  if (!post?.id) return;
  try {
    const payload = { ts: Date.now(), ttl: POST_CACHE_TTL, post };
    localStorage.setItem(POST_CACHE_PREFIX + post.id, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache post:', err);
  }
}

export function getCachedPost(postId) {
  if (!postId) return null;
  try {
    const raw = localStorage.getItem(POST_CACHE_PREFIX + postId);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || POST_CACHE_TTL)) {
      localStorage.removeItem(POST_CACHE_PREFIX + postId);
      return null;
    }
    return payload.post || null;
  } catch (err) {
    return null;
  }
}

// ── COMMENTS CACHE ──
const COMMENTS_CACHE_PREFIX = 'fc_comments_';
const COMMENTS_CACHE_TTL = 1000 * 60 * 2; // 2 min

export function setCachedComments(postId, comments, commentLikes) {
  if (!postId) return;
  try {
    const payload = {
      ts: Date.now(),
      ttl: COMMENTS_CACHE_TTL,
      data: { comments, commentLikes: commentLikes || {} },
    };
    localStorage.setItem(COMMENTS_CACHE_PREFIX + postId, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache comments:', err);
  }
}

export function getCachedComments(postId) {
  if (!postId) return null;
  try {
    const raw = localStorage.getItem(COMMENTS_CACHE_PREFIX + postId);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || COMMENTS_CACHE_TTL)) {
      localStorage.removeItem(COMMENTS_CACHE_PREFIX + postId);
      return null;
    }
    return payload.data || null;
  } catch (err) {
    return null;
  }
}

// ── Sort function for profile posts (pinned first, then by date) ──
export function sortProfilePosts(a, b) {
  // Posts fijados siempre primero, ordenados por pinned_at ascendente (más antiguo arriba)
  if (a.is_pinned && !b.is_pinned) return -1;
  if (!a.is_pinned && b.is_pinned) return 1;
  if (a.is_pinned && b.is_pinned) {
    const dateA = new Date(a.pinned_at).getTime();
    const dateB = new Date(b.pinned_at).getTime();
    return dateB - dateA; // Mas reciente primero
  }
  // No fijados: ordenar por fecha descendente
  const dateA = a._repostInfo?.repostedAt || a.created_at;
  const dateB = b._repostInfo?.repostedAt || b.created_at;
  return new Date(dateB) - new Date(dateA);
}

// ── FEED CACHE (posts + likedIds + repostedIds) ──
const FEED_CACHE_PREFIX = 'fc_feed_';
const FEED_CACHE_TTL = 1000 * 60 * 1; // 1 min

export function setCachedFeed(key, items, likedIds, repostedIds, savedIds) {
  if (!items) return;
  try {
    const payload = {
      ts: Date.now(),
      ttl: FEED_CACHE_TTL,
      data: { items, likedIds: likedIds || [], repostedIds: repostedIds || [], savedIds: savedIds || [] },
    };
    localStorage.setItem(FEED_CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache feed:', err);
  }
}

export function clearFeedCache(key) {
  if (!key) return;
  try {
    localStorage.removeItem(FEED_CACHE_PREFIX + key);
  } catch (err) {
    console.warn('Could not clear feed cache:', err);
  }
}

export function getCachedFeed(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(FEED_CACHE_PREFIX + key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || FEED_CACHE_TTL)) {
      localStorage.removeItem(FEED_CACHE_PREFIX + key);
      return null;
    }
    // Formato nuevo: { items, likedIds, repostedIds }
    if (payload.data?.items) return payload.data;
    // Retrocompatibilidad: devuelve como { items: oldData, likedIds: [], repostedIds: [] }
    if (Array.isArray(payload.data)) {
      return { items: payload.data, likedIds: [], repostedIds: [] };
    }
    return null;
  } catch (err) {
    return null;
  }
}
