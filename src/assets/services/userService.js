import { supabase } from './supabaseclient';

/**
 * Get email by username
 * @param {string} username - Username to find
 * @returns {Promise<string|null>} - Email associated with username or null
 */
function isUnknownColumnError(error, column) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return (
    message.includes(column.toLowerCase()) ||
    message.includes('unknown column') ||
    message.includes('column') && message.includes('does not exist')
  );
}

export async function getEmailByUsername(username) {
  const normalized = username.toLowerCase();

  try {
    // First try by username
    const { data: byUser, error: errUser } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', normalized)
      .maybeSingle();

    if (errUser) {
      console.error('Error querying by username:', errUser);
      // continue even if the username lookup failed
    }

    if (byUser?.email) return byUser.email;
    return null;
  } catch (err) {
    console.error('Get email error:', err);
    return null;
  }
}

/**
 * Check if a username already exists
 * @param {string} username - Username to check
 * @returns {Promise<boolean>} - True if username exists
 */
export async function checkUsernameExists(username) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Error checking username:', error);
      throw error;
    }

    return !!data;
  } catch (err) {
    console.error('Username check error:', err);
    throw err;
  }
}

export async function isUsernameAvailable(username, currentUserId) {
  const normalized = username.toLowerCase();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .maybeSingle();

    if (error) {
      console.error('Error checking username availability:', error);
      throw error;
    }

    if (!data) return true;
    return data.id === currentUserId;
  } catch (err) {
    console.error('Username availability error:', err);
    throw err;
  }
}

/**
 * Check if an email already exists
 * @param {string} email - Email to check
 * @returns {Promise<boolean>} - True if email exists
 */
export async function checkEmailExists(email) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Error checking email:', error);
      throw error;
    }

    return !!data;
  } catch (err) {
    console.error('Email check error:', err);
    throw err;
  }
}

/**
 * Create a user profile after successful registration
 * @param {string} userId - User ID from auth
 * @param {string} email - User email
 * @param {string} username - Username
 * @returns {Promise<object>} - Created profile data
 */
export async function createUserProfile(userId, email, username) {
  const profile = {
    id: userId,
    email: email.toLowerCase(),
    username: username.toLowerCase(),
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('profiles')
      .insert([profile])
      .select()
      .single();

    if (error) {
      console.error('Error creating profile:', error);
      throw error;
    }

    // cache created profile
    try {
      setCachedProfile(data);
    } catch (e) {
      /* ignore */
    }

    return data;
  } catch (err) {
    console.error('Profile creation error:', err);
    throw err;
  }
}

/**
 * Get user profile by ID
 * @param {string} userId - User ID
 * @returns {Promise<object>} - User profile
 */
export async function getUserProfile(userId) {
  try {
    // Intentar cache primero
    const cached = getCachedProfile(userId);
    if (cached) {
      // Fetch en background (no await) para refrescar
      supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data) {
            setCachedProfile(data);
            return data;
          }
        })
        .catch(() => {});
      return cached;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      throw error;
    }

    if (data) setCachedProfile(data);
    return data;
  } catch (err) {
    console.error('Fetch profile error:', err);
    throw err;
  }
}

export async function getUserProfileByUsername(username) {
  try {
    // Intentar cache primero
    const cached = getCachedProfileByUsername(username);
    if (cached) {
      // Fetch en background (no await) para refrescar
      supabase
        .from('profiles')
        .select('*')
        .eq('username', username.toLowerCase())
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data) {
            setCachedProfile(data);
            setCachedProfileByUsername(username, data);
            return data;
          }
        })
        .catch(() => {});
      return cached;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile by username:', error);
      throw error;
    }

    if (data) {
      setCachedProfile(data);
      setCachedProfileByUsername(username, data);
    }
    return data;
  } catch (err) {
    console.error('Fetch profile by username error:', err);
    throw err;
  }
}

/**
 * List all profiles except the current user, ordered by most recent
 * @param {string} [excludeUserId] - Optional user ID to exclude
 * @param {number} [limit=50] - Max results
 * @returns {Promise<Array>} - List of profiles
 */
export async function listProfiles(excludeUserId, limit = 50) {
  try {
    let query = supabase
      .from('profiles')
      .select('id, username, avatar_url, banner_url, bio, roles, created_at, is_private, interests, accent_color, accent_color_secondary, accent_surface_color, accent_surface_glass, banner_position, avatar_position')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error listing profiles:', error);
      throw error;
    }

    return data || [];
  } catch (err) {
    console.error('List profiles error:', err);
    throw err;
  }
}

// --- Simple localStorage cache for profiles ---
const PROFILE_CACHE_PREFIX = 'fc_profile_';
const PROFILE_CACHE_TTL = 1000 * 60 * 60; // 1 hour

export function clearCachedProfile(userId) {
  if (!userId) return;
  try {
    localStorage.removeItem(PROFILE_CACHE_PREFIX + userId);
  } catch (err) {
    console.warn('Could not clear cached profile:', err);
  }
}

export function clearCachedProfileByUsername(username) {
  if (!username) return;
  try {
    localStorage.removeItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
  } catch (err) {
    console.warn('Could not clear cached profile by username:', err);
  }
}

export function setCachedProfile(profile, ttlMs = PROFILE_CACHE_TTL) {
  if (!profile || !profile.id) return;
  try {
    const payload = {
      ts: Date.now(),
      ttl: ttlMs,
      profile,
    };
    localStorage.setItem(PROFILE_CACHE_PREFIX + profile.id, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not set profile cache:', err);
  }
}

export function getCachedProfile(userId) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + userId);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || PROFILE_CACHE_TTL)) {
      localStorage.removeItem(PROFILE_CACHE_PREFIX + userId);
      return null;
    }
    return payload.profile || null;
  } catch (err) {
    console.warn('Could not read profile cache:', err);
    return null;
  }
}

// --- Cache por username (para perfiles ajenos) ---
const PROFILE_USERNAME_PREFIX = 'fc_profile_un_';

export function setCachedProfileByUsername(username, profile) {
  if (!username || !profile?.id) return;
  try {
    // Cache por ID (reutiliza la función existente)
    setCachedProfile(profile);
    // Cache por username (mapea username → ID)
    const index = { id: profile.id, ts: Date.now(), ttl: PROFILE_CACHE_TTL };
    localStorage.setItem(PROFILE_USERNAME_PREFIX + username.toLowerCase(), JSON.stringify(index));
  } catch (err) {
    console.warn('Could not cache profile by username:', err);
  }
}

export function getCachedProfileByUsername(username) {
  if (!username) return null;
  try {
    const raw = localStorage.getItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
    if (!raw) return null;
    const index = JSON.parse(raw);
    if (!index?.id || !index.ts) return null;
    if (Date.now() - index.ts > (index.ttl || PROFILE_CACHE_TTL)) {
      localStorage.removeItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
      return null;
    }
    // Recuperar el perfil completo por ID (usando el cache existente)
    return getCachedProfile(index.id);
  } catch (err) {
    console.warn('Could not read cached profile by username:', err);
    return null;
  }
}

export async function ensureUserProfile(user) {
  if (!user?.id) {
    return null;
  }

  try {
    const existingProfile = await getUserProfile(user.id);
    if (existingProfile) {
      return existingProfile;
    }

    const username =
      user.user_metadata?.username ||
      user.user_metadata?.name ||
      user.email?.split('@')[0];

    if (!username) {
      console.warn('No username available to create profile for user', user.id);
      return null;
    }

    return await createUserProfile(user.id, user.email, username);
  } catch (err) {
    console.error('Ensure profile error:', err);
    throw err;
  }
}

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {object} updates - Profile updates
 * @returns {Promise<object>} - Updated profile
 */
export async function updateUserProfile(userId, updates) {
  try {
    const sanitizedUpdates = { ...updates };
    delete sanitizedUpdates.displayname;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...sanitizedUpdates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating profile:', error);
      throw error;
    }

    // update cache
    try {
      setCachedProfile(data);
    } catch (e) {
      /* ignore */
    }

    return data;
  } catch (err) {
    console.error('Update profile error:', err);
    throw err;
  }
}

// ── Profile views ──

const VIEWED_PROFILE_KEY = 'fc_viewed_profile_';

/**
 * Track a profile view (once per user per profile, dedup via localStorage)
 */
export async function trackProfileView(profileId, userId) {
  if (!profileId) return false;
  const key = VIEWED_PROFILE_KEY + (userId || 'anon');
  try {
    const raw = localStorage.getItem(key);
    const viewed = raw ? JSON.parse(raw) : [];
    if (viewed.includes(profileId)) return false;

    // Increment profile_views_count (resiliente a columna faltante)
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('profile_views_count')
        .eq('id', profileId)
        .single();

      if (profile) {
        await supabase
          .from('profiles')
          .update({ profile_views_count: (profile.profile_views_count || 0) + 1 })
          .eq('id', profileId);
      }
    } catch (e) {
      console.warn('profile_views_count not available for tracking:', e?.message || e);
    }

    viewed.push(profileId);
    localStorage.setItem(key, JSON.stringify(viewed));
    return true;
  } catch (err) {
    console.warn('Error tracking profile view:', err);
    return false;
  }
}

export async function updateAuthUserMetadata(updates) {
  try {
    const { data, error } = await supabase.auth.updateUser({
      data: updates,
    });

    if (error) {
      console.error('Error updating auth user metadata:', error);
      throw error;
    }

    return data;
  } catch (err) {
    console.error('Auth user metadata update error:', err);
    throw err;
  }
}
