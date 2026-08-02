import { supabase } from './supabaseclient';
import { getItem, setItem, removeItem } from './secureStorage';
import { getCdnUrl } from './cdnService';
import { sanitizeContent } from './helpers';

/**
 * Normaliza TODAS las URLs del CDN en un objeto profile para garantizar
 * que sean rutas relativas (/cdn/files/xxx) y nunca HTTP directo.
 * Se aplica en cada respuesta de Supabase para eliminar Mixed Content de raíz.
 *
 * ⚠️ Usa getCdnUrl() en vez de normalizeCdnUrl() para NO romper URLs externas
 *    (getCdnUrl solo modifica URLs que empiezan con /cdn/).
 */
function normalizeProfileUrls(profile) {
  if (!profile) return profile;
  const fields = ['avatar_url', 'banner_url', 'profile_background_url'];
  for (const field of fields) {
    if (profile[field]) {
      profile[field] = getCdnUrl(profile[field]);
    }
  }
  return profile;
}

// ── Límites coherentes de caracteres (una sola fuente de verdad) ──
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAYNAME_MAX = 50;
export const PRONOUNS_MAX = 30;
export const BIO_MAX = 80;
export const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * Valida campos de perfil contra los límites coherentes.
 * @param {object} fields - { username, displayname, pronouns, bio }
 * @param {object} [opts] - { minUsername } — false solo en rutas de creación
 *                          automática (OAuth/legacy) donde el username puede
 *                          derivarse del email.
 * @returns {string|null} - Mensaje de error o null si todo está bien.
 */
export function validateProfileFields(fields = {}, { minUsername = true } = {}) {
  if (typeof fields.username === 'string') {
    const u = fields.username.trim();
    if (!USERNAME_RE.test(u)) return 'Username can only contain letters, numbers and underscores';
    if (u.length > USERNAME_MAX) return `Username can't exceed ${USERNAME_MAX} characters`;
    if (minUsername && u.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`;
  }
  if (typeof fields.displayname === 'string' && fields.displayname.trim().length > DISPLAYNAME_MAX) {
    return `Display name can't exceed ${DISPLAYNAME_MAX} characters`;
  }
  if (typeof fields.pronouns === 'string' && fields.pronouns.trim().length > PRONOUNS_MAX) {
    return `Pronouns can't exceed ${PRONOUNS_MAX} characters`;
  }
  if (typeof fields.bio === 'string' && fields.bio.trim().length > BIO_MAX) {
    return `Bio can't exceed ${BIO_MAX} characters`;
  }
  return null;
}

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
export async function createUserProfile(userId, email, username, displayname) {
  // Validación de límites (sin mínimo: rutas automáticas derivan el username)
  const err = validateProfileFields({ username, displayname }, { minUsername: false });
  if (err) throw new Error(err);

  const profile = {
    id: userId,
    email: email.toLowerCase(),
    username: username.trim().toLowerCase(),
    displayname: displayname || username,
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
    // Leer cache para el render inicial (el useState en profile.jsx lo usa)
    const cached = getCachedProfile(userId);

    // Siempre fetch fresh data — aunque haya cache, resolvemos con datos frescos
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      if (cached) {
        console.warn('Falling back to cached profile after fetch error');
        return cached;
      }
      throw error;
    }

    if (data) {
      normalizeProfileUrls(data);
      setCachedProfile(data);
    }
    return data;
  } catch (err) {
    console.error('Fetch profile error:', err);
    throw err;
  }
}

export async function getUserProfileByUsername(username) {
  try {
    // Leer cache para el render inicial (el useState en profile.jsx lo usa)
    const cached = getCachedProfileByUsername(username);

    // Siempre fetch fresh data — aunque haya cache, resolvemos con datos frescos
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username.toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile by username:', error);
      if (cached) {
        console.warn('Falling back to cached profile after fetch error');
        return cached;
      }
      throw error;
    }

    if (data) {
      normalizeProfileUrls(data);
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
/**
 * Search profiles by username (for user selector in encrypted posts)
 * @param {string} query - Search query
 * @param {string} [excludeUserId] - Optional user ID to exclude
 * @param {number} [limit=10] - Max results
 * @returns {Promise<Array>} - Matching profiles
 */
export async function searchProfiles(query, excludeUserId, limit = 10) {
  try {
    let dbQuery = supabase
      .from('profiles')
      .select('id, username, displayname, avatar_url')
      .ilike('username', `%${query.toLowerCase()}%`)
      .order('username', { ascending: true })
      .limit(limit);

    if (excludeUserId) {
      dbQuery = dbQuery.neq('id', excludeUserId);
    }

    const { data, error } = await dbQuery;
    if (error) {
      console.error('Error searching profiles:', error);
      return [];
    }
    // Normalizar URLs del CDN en resultados de búsqueda
    if (data) data.forEach(normalizeProfileUrls);
    return data || [];
  } catch (err) {
    console.error('Search profiles error:', err);
    return [];
  }
}

export async function listProfiles(excludeUserId, limit = 50) {
  try {
    let query = supabase
      .from('profiles')
      .select('id, username, displayname, avatar_url, banner_url, bio, pronouns, roles, created_at, is_private, interests, accent_color, accent_color_secondary, accent_surface_color, accent_surface_glass, accent_visibility, show_accent_profile, show_accent_explore, banner_position, avatar_position')
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

    // Normalizar URLs del CDN en todos los perfiles listados
    if (data) data.forEach(normalizeProfileUrls);
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
    removeItem(PROFILE_CACHE_PREFIX + userId);
  } catch (err) {
    console.warn('Could not clear cached profile:', err);
  }
}

export function clearCachedProfileByUsername(username) {
  if (!username) return;
  try {
    removeItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
  } catch (err) {
    console.warn('Could not clear cached profile by username:', err);
  }
}

export function setCachedProfile(profile, ttlMs = PROFILE_CACHE_TTL) {
  if (!profile || !profile.id) return;
  try {
    // Strip sensitive fields (email) before caching in localStorage
    const { email, ...safeProfile } = profile;
    const payload = {
      ts: Date.now(),
      ttl: ttlMs,
      profile: safeProfile,
    };
    setItem(PROFILE_CACHE_PREFIX + profile.id, payload);
  } catch (err) {
    console.warn('Could not set profile cache:', err);
  }
}

export function getCachedProfile(userId) {
  try {
    const payload = getItem(PROFILE_CACHE_PREFIX + userId);
    if (!payload || !payload.ts) return null;
    if (Date.now() - payload.ts > (payload.ttl || PROFILE_CACHE_TTL)) {
      removeItem(PROFILE_CACHE_PREFIX + userId);
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
    setItem(PROFILE_USERNAME_PREFIX + username.toLowerCase(), index);
  } catch (err) {
    console.warn('Could not cache profile by username:', err);
  }
}

export function getCachedProfileByUsername(username) {
  if (!username) return null;
  try {
    const index = getItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
    if (!index?.id || !index.ts) return null;
    if (Date.now() - index.ts > (index.ttl || PROFILE_CACHE_TTL)) {
      removeItem(PROFILE_USERNAME_PREFIX + username.toLowerCase());
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

    // Derivar un username válido: solo [a-z0-9_], minúsculas, máx 20.
    // Sanitizamos porque el origen puede ser el prefijo del email (con puntos)
    // o el display name de OAuth (con espacios/emojis), y createUserProfile
    // ya valida estrictamente el formato.
    const raw =
      user.user_metadata?.username ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      '';
    const username = String(raw)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, USERNAME_MAX);

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
    const safeUpdates = { ...updates };
    // Validar límites coherentes antes de escribir en la DB
    const err = validateProfileFields(safeUpdates);
    if (err) throw new Error(err);
    if (typeof safeUpdates.bio === 'string') {
      safeUpdates.bio = sanitizeContent(safeUpdates.bio);
    }
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...safeUpdates,
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
    const viewed = getItem(key) || [];
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
    setItem(key, viewed);
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
