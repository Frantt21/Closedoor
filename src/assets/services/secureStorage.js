/**
 * Secure Storage
 *
 * Encrypted wrapper around localStorage + sessionStorage.
 * - Keys: hashed with a fast one-way hash so key names aren't readable
 * - Values: XOR-encrypted with a random session key so they're not plain text/JSON
 * - XOR key is stored in LOCALstorage (no sessionStorage) so it survives
 *   browser tab closes — this is required because Supabase auth session
 *   data is encrypted with this key and stored in localStorage.
 * - API is 100% synchronous (no async/await needed)
 *
 * This prevents casual inspection of cached data via DevTools localStorage view.
 * Data in localStorage will appear as unreadable hashed keys with base64 values.
 */

// ── Internal state ──

const STORAGE_PREFIX = '_s';
const SESSION_STORAGE_PREFIX = '_ss';
const XOR_KEY_STORAGE_RAW = '_xk';

// XOR key — persisted in localStorage so it survives tab closes
// The XOR key itself is stored under a hashed key like any other entry
let _xorKey = null;

function getXorKey() {
  if (_xorKey) return _xorKey;
  // Try to restore existing key from localStorage (survives tab close & page reload)
  try {
    const hashed = hashKey(XOR_KEY_STORAGE_RAW);
    const stored = localStorage.getItem(hashed);
    if (stored) {
      _xorKey = Uint8Array.from(JSON.parse(stored));
      return _xorKey;
    }
  } catch {}
  // Generate new key and persist it in localStorage
  _xorKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    const hashed = hashKey(XOR_KEY_STORAGE_RAW);
    localStorage.setItem(hashed, JSON.stringify(Array.from(_xorKey)));
  } catch {}
  return _xorKey;
}

/**
 * Fast one-way hash for storage keys.
 * Uses DJB2 algorithm — fast, produces short hex-like strings.
 * Result is deterministic (same input → same output).
 */
function hashKey(rawKey) {
  const str = STORAGE_PREFIX + rawKey;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // 32-bit integer
  }
  return STORAGE_PREFIX + Math.abs(hash).toString(36);
}

/**
 * XOR-encrypt a value into a base64 string.
 */
function encrypt(value) {
  const key = getXorKey();
  const json = JSON.stringify(value);
  const encoded = new TextEncoder().encode(json);
  const result = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    result[i] = encoded[i] ^ key[i % key.length];
  }
  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt a base64 XOR-encrypted string back to its original value.
 */
function decrypt(ciphertext) {
  const key = getXorKey();
  const decoded = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    result[i] = decoded[i] ^ key[i % key.length];
  }
  return JSON.parse(new TextDecoder().decode(result));
}

// ── localStorage API ──

/**
 * Get a decrypted value from localStorage.
 * Returns null if key doesn't exist or decryption fails (old plain-text entry).
 */
export function getItem(key) {
  try {
    const hashed = hashKey(key);
    const raw = localStorage.getItem(hashed);
    if (!raw) return null;
    return decrypt(raw);
  } catch {
    return null;
  }
}

/**
 * Encrypt a value and store in localStorage.
 * @param {string} key
 * @param {any} value - Will be JSON.stringify'd before encryption
 */
export function setItem(key, value) {
  try {
    const hashed = hashKey(key);
    const encrypted = encrypt(value);
    localStorage.setItem(hashed, encrypted);
  } catch {
    // Storage might be full — fail silently
  }
}

/**
 * Remove an encrypted entry from localStorage.
 */
export function removeItem(key) {
  try {
    const hashed = hashKey(key);
    localStorage.removeItem(hashed);
  } catch {
    // Ignore
  }
}

/**
 * Remove ALL encrypted entries + old plain-text fc_* entries from localStorage.
 */
export function clearAll() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
      // Old plain-text cache keys — migration cleanup
      if (k.startsWith('fc_')) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

// ── sessionStorage API ──

function hashSessionKey(rawKey) {
  const str = SESSION_STORAGE_PREFIX + rawKey;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return SESSION_STORAGE_PREFIX + Math.abs(hash).toString(36);
}

/**
 * Get a decrypted value from sessionStorage.
 */
export function getSessionItem(key) {
  try {
    const hashed = hashSessionKey(key);
    const raw = sessionStorage.getItem(hashed);
    if (!raw) return null;
    return decrypt(raw);
  } catch {
    return null;
  }
}

/**
 * Encrypt a value and store in sessionStorage.
 */
export function setSessionItem(key, value) {
  try {
    const hashed = hashSessionKey(key);
    const encrypted = encrypt(value);
    sessionStorage.setItem(hashed, encrypted);
  } catch {
    // Storage might be full
  }
}

/**
 * Remove an encrypted entry from sessionStorage.
 */
export function removeSessionItem(key) {
  try {
    const hashed = hashSessionKey(key);
    sessionStorage.removeItem(hashed);
  } catch {
    // Ignore
  }
}
