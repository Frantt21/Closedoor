import { supabase } from './supabaseclient';

/**
 * Extract #hashtags from text content
 */
const HASHTAG_REGEX = /(?<![#\w])#([a-zA-Z0-9_\u00C0-\u024F]+)/g;

export function extractHashtags(content) {
  if (!content) return [];
  const tags = new Set();
  let match;
  while ((match = HASHTAG_REGEX.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    if (tag) tags.add(tag);
  }
  return Array.from(tags);
}

/**
 * Store hashtags for a post: upsert hashtags and create post_hashtags relations
 */
export async function resolveHashtags(postId, content) {
  const tags = extractHashtags(content);
  if (!tags.length) return;

  // Upsert each hashtag via the bump function, then insert post_hashtags
  for (const tag of tags) {
    const { data: hId, error: bumpError } = await supabase
      .rpc('bump_hashtag_usage', { p_name: tag });

    if (bumpError) {
      // Fallback: if RPC doesn't exist, do it manually
      console.warn('bump_hashtag_usage RPC not available, falling back to manual upsert:', bumpError.message);
      try {
        // Upsert hashtag
        const { data: hashtag, error: upsertError } = await supabase
          .from('hashtags')
          .upsert(
            { name: tag },
            { onConflict: 'name', ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (upsertError) {
          console.warn('Error upserting hashtag:', upsertError.message);
          continue;
        }

        // Insert relation
        const { error: relError } = await supabase
          .from('post_hashtags')
          .upsert(
            { post_id: postId, hashtag_id: hashtag.id },
            { onConflict: 'post_id,hashtag_id' }
          );

        if (relError) {
          console.warn('Error inserting post_hashtag:', relError.message);
        }
      } catch (err) {
        console.warn('Error in hashtag fallback:', err);
      }
      continue;
    }

    // RPC succeeded — insert relation
    const { error: relError } = await supabase
      .from('post_hashtags')
      .upsert(
        { post_id: postId, hashtag_id: hId },
        { onConflict: 'post_id,hashtag_id' }
      );

    if (relError) {
      console.warn('Error inserting post_hashtag:', relError.message);
    }
  }
}

/**
 * Get trending hashtags (solo posts de perfiles públicos), con cache localStorage.
 * El cache se usa para el render inicial (useState) y como fallback si el fetch falla.
 */
export async function getTrendingHashtags(limit = 10) {
  try {
    return await getTrendingHashtagsFresh(limit);
  } catch (err) {
    console.warn('Error fetching trending hashtags, falling back to cache:', err.message);
    const cached = getCache(TRENDING_HASHTAGS_CACHE_KEY);
    return cached ? cached.slice(0, limit) : [];
  }
}

async function getTrendingHashtagsFresh(limit) {
  try {
    // 1. Get public profile IDs
    const { data: publicProfiles, error: profError } = await supabase
      .from('profiles')
      .select('id')
      .or('is_private.is.null,is_private.eq.false');

    if (profError) throw profError;
    if (!publicProfiles?.length) return [];

    const publicUserIds = publicProfiles.map(p => p.id);

    // 2. Get recent post IDs from those profiles (24h) + validar mínimo de actividad
    // Excluir posts encriptados del trending (is_encrypted != true)
    const hoursAgo = new Date(Date.now() - TRENDING_HOURS * 60 * 60 * 1000).toISOString();
    const { data: recentPosts, error: postError } = await supabase
      .from('posts')
      .select('id')
      .in('user_id', publicUserIds)
      .gte('created_at', hoursAgo)
      .neq('is_encrypted', true);

    if (postError) throw postError;
    if (!recentPosts?.length || recentPosts.length < MIN_POSTS_FOR_TRENDING) {
      // Tendencia terminada, cachear vacío por 30 min
      setCache(TRENDING_HASHTAGS_CACHE_KEY, [], TRENDING_ENDED_TTL);
      return [];
    }

    const postIds = recentPosts.map(p => p.id);

    // 3. Get hashtag associations for those posts
    const { data: postHashtags, error: phError } = await supabase
      .from('post_hashtags')
      .select('hashtag_id, hashtags!post_hashtags_hashtag_id_fkey (id, name)')
      .in('post_id', postIds);

    if (phError) throw phError;
    if (!postHashtags?.length) return [];

    // 4. Count occurrences per hashtag name
    const countMap = new Map();
    for (const row of postHashtags) {
      const tag = row.hashtags;
      if (!tag?.name) continue;
      countMap.set(tag.name, (countMap.get(tag.name) || 0) + 1);
    }

    // 5. Sort by count descending and save to cache
    const result = [...countMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, use_count: count }));

    setCache(TRENDING_HASHTAGS_CACHE_KEY, result);
    return result;

  } catch (err) {
    console.warn('Error fetching trending hashtags, using fallback:', err.message);
    // Fallback: consulta con filtro de 24h por last_used_at
    const hoursAgo = new Date(Date.now() - TRENDING_HOURS * 60 * 60 * 1000).toISOString();
    const { data: fallback } = await supabase
      .from('hashtags')
      .select('id, name, use_count, last_used_at')
      .gte('last_used_at', hoursAgo)
      .order('use_count', { ascending: false })
      .limit(limit);
    const fallbackResult = fallback || [];
    setCache(TRENDING_HASHTAGS_CACHE_KEY, fallbackResult);
    return fallbackResult;
  }
}

/**
 * Get posts that have a specific hashtag
 */
export async function getPostsByHashtag(tag, { limit = 20, offset = 0 } = {}) {
  const cleanTag = tag.toLowerCase().replace(/^#/, '');

  const { data, error } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)')
    .in('id', (await getPostIdsByHashtag(cleanTag, limit, offset)))
    .neq('is_encrypted', true)
    .or('scheduled_at.is.null,scheduled_at.lte.now')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching posts by hashtag:', error);
    return [];
  }
  return data || [];
}

async function getPostIdsByHashtag(tag, limit, offset) {
  const { data, error } = await supabase
    .from('post_hashtags')
    .select('post_id')
    .eq('hashtag_id', (await getHashtagId(tag)))
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data?.length) return [];
  return data.map(ph => ph.post_id);
}

async function getHashtagId(name) {
  const { data, error } = await supabase
    .from('hashtags')
    .select('id')
    .eq('name', name.toLowerCase())
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

/**
 * Check if a hashtag exists
 */
export async function hashtagExists(name) {
  const id = await getHashtagId(name);
  return id !== null;
}

// ── CACHE ──
const TRENDING_WORDS_CACHE_KEY = 'fc_trending_words';
const TRENDING_HASHTAGS_CACHE_KEY = 'fc_trending_hashtags';
const TRENDING_CACHE_TTL = 1000 * 60 * 10; // 10 min
const TRENDING_ENDED_TTL = 1000 * 60 * 30; // 30 min (cuando no hay suficientes posts)
const MIN_POSTS_FOR_TRENDING = 5;
const TRENDING_HOURS = 24;

function setCache(key, data, customTtl) {
  try {
    const payload = { ts: Date.now(), ttl: customTtl || TRENDING_CACHE_TTL, data };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not cache trending data:', err);
  }
}

function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload?.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || TRENDING_CACHE_TTL)) {
      localStorage.removeItem(key);
      return null;
    }
    return payload.data || null;
  } catch (err) {
    return null;
  }
}

/**
 * Lectura síncrona del cache (para useState initializer — evita skeleton flash)
 */
export function getCachedTrendingWords() {
  return getCache(TRENDING_WORDS_CACHE_KEY);
}

export function getCachedTrendingHashtags() {
  return getCache(TRENDING_HASHTAGS_CACHE_KEY);
}

export function clearTrendingCache() {
  try {
    localStorage.removeItem(TRENDING_WORDS_CACHE_KEY);
    localStorage.removeItem(TRENDING_HASHTAGS_CACHE_KEY);
  } catch (err) {
    /* ignore */
  }
}

/**
 * Filtra palabras trending que también aparecen como hashtags,
 * para evitar duplicados entre las dos secciones.
 */
export function deduplicateTrending(words, hashtags) {
  if (!words?.length || !hashtags?.length) return words || [];
  const hashtagNames = new Set(hashtags.map((h) => h.name?.toLowerCase()));
  return words.filter((w) => !hashtagNames.has(w.word?.toLowerCase()));
}

// ── TRENDING WORDS ──

/**
 * Get trending words from recent posts (via RPC), con cache localStorage.
 * El cache se usa para el render inicial (useState) y como fallback si el fetch falla.
 */
export async function getTrendingWords(limit = 8) {
  try {
    return await getTrendingWordsFresh(limit);
  } catch (err) {
    console.warn('Error fetching trending words, falling back to cache:', err.message);
    const cached = getCache(TRENDING_WORDS_CACHE_KEY);
    return cached ? cached.slice(0, limit) : [];
  }
}

async function getTrendingWordsFresh(limit) {
  try {
    const { data, error } = await supabase
      .rpc('get_trending_words', { limit_count: limit, hours_back: TRENDING_HOURS });

    if (error) {
      console.warn('Error fetching trending words (RPC may not exist yet):', error.message);
      return [];
    }
    const result = data || [];
    // Si el RPC no devolvió nada, cachear vacío por 30 min (tendencia terminada)
    setCache(TRENDING_WORDS_CACHE_KEY, result, result.length === 0 ? TRENDING_ENDED_TTL : undefined);
    return result;
  } catch (err) {
    console.warn('Error in getTrendingWords:', err);
    return [];
  }
}

/**
 * Search posts by content text (for trending word clicks)
 */
export async function searchPostsByContent(query, { limit = 20, offset = 0 } = {}) {
  if (!query || query.length < 2) return [];

  try {
    const { data, error } = await supabase
      .from('posts')
      .select('*, profiles!posts_user_id_fkey (id, username, avatar_url, roles, is_private)')
      .ilike('content', `%${query}%`)
      .neq('is_encrypted', true)
      .or('scheduled_at.is.null,scheduled_at.lte.now')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error searching posts by content:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Error in searchPostsByContent:', err);
    return [];
  }
}
