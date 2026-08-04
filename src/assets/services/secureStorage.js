/**
 * Secure Storage
 *
 * Encrypted wrapper around localStorage + sessionStorage.
 * - Keys: hashed with a fast one-way hash so key names aren't readable
 * - Values: XOR-encrypted with a **per-entry key** derived via SHA-256
 *   from the master key and the entry name. Each entry gets a unique key,
 *   so compromising one entry doesn't compromise others.
 * - Master key is a 256-bit CSPRNG key stored in localStorage.
 * - API is 100% synchronous.
 *
 * Security improvement over basic XOR:
 *  - XOR with a single global key → deducible with enough ciphertext ↔ plaintext
 *  - XOR with per-entry HMAC-derived keys → each entry is independent
 *  - Per-entry keys are derived via SHA-256 (pure JS, synchronous)
 *
 * This prevents casual inspection of cached data via DevTools localStorage view.
 * Data in localStorage will appear as unreadable hashed keys with base64 values.
 */

// ── Internal state ──

const STORAGE_PREFIX = '_s';
const SESSION_STORAGE_PREFIX = '_ss';
const KEY_STORAGE_RAW = '_xk';  // Same key name as before for backward compat

let _masterKey = null;
let _derivedKeyCache = new Map();

/**
 * Get or generate the 32-byte master key material from localStorage.
 * Supports both legacy XOR format (JSON array) and new base64 format.
 */
function getMasterKey() {
  if (_masterKey) return _masterKey;

  const hashed = hashKey(KEY_STORAGE_RAW);
  const stored = localStorage.getItem(hashed);

  if (stored) {
    try {
      // Legacy XOR key format: Uint8Array stored as JSON array
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length === 32) {
        const legacy = new Uint8Array(parsed);
        // Migrate to new format
        try {
          localStorage.setItem(hashed, btoa(String.fromCharCode(...legacy)));
        } catch {}
        _masterKey = legacy;
        return _masterKey;
      }
    } catch {}
    // New format: base64-encoded 32-byte key
    try {
      const raw = atob(stored);
      if (raw.length === 32) {
        _masterKey = Uint8Array.from(raw, c => c.charCodeAt(0));
        return _masterKey;
      }
    } catch {}
  }

  // Generate new 32-byte master key (cryptographically random)
  _masterKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    localStorage.setItem(hashed, btoa(String.fromCharCode(..._masterKey)));
  } catch {}
  return _masterKey;
}

/**
 * Derive a per-entry XOR key using SHA-256.
 * SHA-256(masterKey || entryName) → 32 bytes
 * Uses a pure-JS SHA-256 implementation for synchronous operation.
 * Results are cached in a Map for fast subsequent access.
 */
function deriveEntryKey(entryName) {
  if (_derivedKeyCache.has(entryName)) {
    return _derivedKeyCache.get(entryName);
  }

  const masterKey = getMasterKey();
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(entryName);

  // Input: masterKey (32 bytes) + entryName (variable)
  const input = new Uint8Array(masterKey.length + nameBytes.length);
  input.set(masterKey);
  input.set(nameBytes, masterKey.length);

  // SHA-256 hash (pure JS)
  const hash = sha256(input);

  _derivedKeyCache.set(entryName, hash);
  return hash;
}

// ── Pure JS SHA-256 implementation (synchronous) ──

/**
 * SHA-256 hash function (pure JavaScript, synchronous).
 * Returns a 32-byte Uint8Array.
 */
function sha256(message) {
  const data = message instanceof Uint8Array ? message : new TextEncoder().encode(message);

  // Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes)
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  // Round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  // Pre-processing: pad the message
  const bitLength = data.length * 8;
  const paddedLength = (((data.length + 9 + 63) / 64) | 0) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;

  // Append length in bits as big-endian 64-bit value
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  // Process each 512-bit block
  const W = new Uint32Array(64);
  for (let block = 0; block < paddedLength; block += 64) {
    // Prepare the message schedule
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(block + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    // Working variables
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    // Compression function main loop
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    // Compute the new hash values
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  // Produce the final hash value (big-endian)
  const hash = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    hash[i * 4] = (H[i] >>> 24) & 0xff;
    hash[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    hash[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    hash[i * 4 + 3] = H[i] & 0xff;
  }
  return hash;
}

/**
 * 32-bit right rotation.
 */
function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
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
 * XOR-encrypt a value using a per-entry derived key.
 * Each entry name produces a different key via SHA-256 derivation.
 */
function encrypt(value, entryName) {
  const key = deriveEntryKey(entryName);
  const json = JSON.stringify(value);
  const encoded = new TextEncoder().encode(json);
  const result = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    result[i] = encoded[i] ^ key[i % key.length];
  }
  // Chunked binary conversion to avoid RangeError on large data
  let binary = '';
  const CHUNK = 0x8000; // 32KB
  for (let i = 0; i < result.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, result.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decrypt a base64 XOR-encrypted string back to its original value.
 */
function decrypt(ciphertext, entryName) {
  const key = deriveEntryKey(entryName);
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
 * Returns null if key doesn't exist or decryption fails.
 */
export function getItem(key) {
  try {
    const hashed = hashKey(key);
    const raw = localStorage.getItem(hashed);
    if (!raw) return null;
    return decrypt(raw, key);
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
    const encrypted = encrypt(value, key);
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
    return decrypt(raw, key);
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
    const encrypted = encrypt(value, key);
    sessionStorage.setItem(hashed, encrypted);
    return true;
  } catch {
    // Storage might be full (QuotaExceededError) or value too large
    return false;
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