/**
 * Secure Storage
 *
 * Encrypted wrapper around localStorage + sessionStorage.
 *
 * 🔑 Key management:
 *  - Master key (32 bytes CSPRNG) lives in **memory** at runtime.
 *  - On disk it is NEVER stored raw: it is wrapped with AES-GCM (Web Crypto)
 *    using a **non-extractable CryptoKey** persisted in IndexedDB. Even with
 *    full access to IndexedDB, the key material cannot be exported
 *    (extractable: false), so a storage thief cannot read the raw key bytes.
 *  - The wrap key + encrypted blob live in IndexedDB, which is not readable
 *    in the DevTools localStorage panel.
 *  - If Web Crypto is unavailable (insecure context) or IndexedDB is blocked,
 *    we degrade to raw localStorage/IDB so sessions still survive reloads.
 *  - Resilience tradeoff: a non-extractable CryptoKey cannot be exported or
 *    backed up. Clearing site data or losing IndexedDB means the wrapped key
 *    is unrecoverable → the stored session becomes undecryptable and the user
 *    must log in again once. This is the accepted price of the security gain.
 *
 * 🔐 Cipher:
 *  - Values are XOR-encrypted with a **per-entry, per-write key** derived via
 *    SHA-256 (pure JS, synchronous — Web Crypto is async-only and our API
 *    must stay synchronous because it backs React lazy initializers and the
 *    Supabase storage adapter).
 *  - Each write embeds a random 16-byte salt, so even the same entry written
 *    twice produces different ciphertext (defeats ciphertext correlation).
 *  - Compromising one entry does not compromise others.
 *
 * 🧩 Format:
 *  - v2: JSON { v:2, s:<salt b64>, c:<ciphertext b64> }
 *  - legacy: plain base64 ciphertext (auto-detected and still decryptable)
 *
 * ⚠️ Threat model:
 *  - The wrap key is a NON-EXTRACTABLE CryptoKey: a script that steals the
 *    IndexedDB contents cannot export the key bytes, so the cached data stays
 *    sealed (the XOR layers are unrecoverable without the master key).
 *  - It does NOT protect against **active XSS** on the same origin (an
 *    injected script can call the app's own APIs to decrypt at runtime).
 *    No client-side scheme can fully prevent that. Accept the tradeoff.
 *
 * This prevents casual inspection of cached data via DevTools.
 */

// ── Internal state ──

const STORAGE_PREFIX = '_s';
const SESSION_STORAGE_PREFIX = '_ss';
const KEY_STORAGE_RAW = '_xk'; // legacy localStorage key name (migration)
const KEY_RECORD = 'fc_master_key_v2'; // legacy RAW key record (IDB, migration only)
const WRAP_KEY_RECORD = 'fc_wrap_key_v2'; // non-extractable AES-GCM CryptoKey (IDB)
const WRAP_BLOB_RECORD = 'fc_wrap_blob_v2'; // { iv, ct } → wrapped master key (IDB)

const IDB_NAME = 'fc_secure_storage';
const IDB_STORE = 'kv';

let _masterKey = null;     // in-memory 32 bytes
let _ready = false;
let _readyPromise = null;
let _persistMode = null;   // 'idb' | 'local' | 'memory'

// ── IndexedDB helpers ──

function idbSupported() {
  return typeof indexedDB !== 'undefined';
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB blocked'));
    } catch (err) {
      reject(err);
    }
  });
}

async function idbGet(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(record);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(record, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Web Crypto wrapping helpers ──

function subtleAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function';
}

/**
 * Generate a NON-EXTRACTABLE AES-GCM key used only to wrap/unwrap the master
 * key. Because extractable:false, crypto.subtle.exportKey() will always throw,
 * so the key bytes can never be exfiltrated from IndexedDB.
 */
async function generateWrapKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

async function wrapMasterKey(wrapKey, masterKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, masterKey));
  return { iv: uint8ToBase64(iv), ct: uint8ToBase64(ct) };
}

async function unwrapMasterKey(wrapKey, blob) {
  const iv = base64ToUint8(blob.iv);
  const ct = base64ToUint8(blob.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
  return new Uint8Array(plain);
}

// ── Key material parsing (supports legacy formats) ──

function parseKeyMaterial(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 32) {
      return new Uint8Array(parsed); // legacy XOR JSON-array format
    }
  } catch {}
  try {
    const bytes = atob(raw);
    if (bytes.length === 32) {
      return Uint8Array.from(bytes, (c) => c.charCodeAt(0)); // base64 format
    }
  } catch {}
  return null;
}

function localStorageKeyName() {
  return hashKey(KEY_STORAGE_RAW);
}

// ── Warmup / readiness ──

/**
 * Load (or create) the master key and persist it.
 * - Preferred: IndexedDB (key NOT in localStorage)
 * - Degraded: localStorage (only if IDB unavailable)
 * - Last resort: in-memory only
 */
function warmup() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    try {
      if (idbSupported()) {
        let wrapped = false;
        let unboxed = false; // true only when the master key came from a successful unbox

        // 1) Preferred: unbox master key from the non-extractable wrap key.
        if (subtleAvailable()) {
          try {
            const wrapKey = await idbGet(WRAP_KEY_RECORD);
            const blob = await idbGet(WRAP_BLOB_RECORD);
            if (wrapKey && blob) {
              _masterKey = await unwrapMasterKey(wrapKey, blob);
              _persistMode = 'idb';
              wrapped = true;
              unboxed = true;
            }
          } catch (err) {
            console.warn('[SecureStorage] wrap unbox failed:', err?.message);
          }
        }

        // 2) Migration: read legacy RAW key from IDB (if any)
        if (!_masterKey) {
          try {
            const stored = await idbGet(KEY_RECORD);
            if (stored) {
              _masterKey = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
              _persistMode = 'idb';
            }
          } catch (err) {
            console.warn('[SecureStorage] IDB read failed:', err?.message);
          }
        }

        // 3) Migration: read legacy key from localStorage (if any)
        if (!_masterKey) {
          try {
            const legacy = localStorage.getItem(localStorageKeyName());
            _masterKey = parseKeyMaterial(legacy);
          } catch {}
        }

        // 4) First run ever: generate a fresh master key
        if (!_masterKey) {
          _masterKey = crypto.getRandomValues(new Uint8Array(32));
        }

        // 5) Wrap the master key (never store raw bytes on disk when possible)
        if (!wrapped && subtleAvailable()) {
          try {
            let wrapKey = await idbGet(WRAP_KEY_RECORD);
            if (!wrapKey) wrapKey = await generateWrapKey();
            const blob = await wrapMasterKey(wrapKey, _masterKey);
            await idbSet(WRAP_KEY_RECORD, wrapKey);
            await idbSet(WRAP_BLOB_RECORD, blob);
            _persistMode = 'idb';
            wrapped = true;
          } catch (err) {
            console.warn('[SecureStorage] wrap persist failed; storing raw:', err?.message);
          }
        }

        // 6) Persist (raw only as degraded fallback when wrapping is impossible)
        if (!wrapped) {
          try {
            await idbSet(KEY_RECORD, _masterKey);
            _persistMode = 'idb';
          } catch {
            // IDB write failed → persist to localStorage as degraded fallback,
            // otherwise a freshly-generated key would be lost on reload and
            // all encrypted entries would become undecryptable.
            _persistMode = 'local';
            try {
              localStorage.setItem(localStorageKeyName(), btoa(String.fromCharCode(..._masterKey)));
            } catch {}
          }
        } else {
          // Self-healing: only remove the legacy raw key record after a SUCCESSFUL
          // unbox (a later load), never on the load that just created the wrap.
          // If the blob is ever corrupt, the raw key still exists to recover and
          // re-wrap (step 2 → step 5), instead of silently minting a new key that
          // would brick all previously-encrypted entries (incl. the session).
          if (unboxed) {
            try { await idbDelete(KEY_RECORD); } catch {}
          }
        }

        // Purge legacy key from localStorage (we're on IDB now)
        if (_persistMode === 'idb') {
          try { localStorage.removeItem(localStorageKeyName()); } catch {}
        }
      } else {
        // IndexedDB unavailable → degraded persistence in localStorage
        try {
          const legacy = localStorage.getItem(localStorageKeyName());
          _masterKey = parseKeyMaterial(legacy);
        } catch {}
        if (!_masterKey) {
          _masterKey = crypto.getRandomValues(new Uint8Array(32));
        }
        _persistMode = 'local';
        try {
          localStorage.setItem(localStorageKeyName(), btoa(String.fromCharCode(..._masterKey)));
        } catch {}
      }
      _ready = true;
    } catch (err) {
      console.warn('[SecureStorage] Warmup failed; using in-memory key:', err?.message);
      try { _masterKey = crypto.getRandomValues(new Uint8Array(32)); } catch {}
      _persistMode = 'memory';
      _ready = true;
    }
  })();
  _readyPromise.catch(() => {});
  return _readyPromise;
}

// Kick off warmup immediately (module load)
warmup();

/**
 * Await key readiness. Used by the auth restore path so the session can be
 * decrypted reliably before the app decides the user is logged out.
 */
export function waitForKeyReady() {
  return warmup();
}

/**
 * Synchronous access to key bytes.
 * Returns null if not ready yet (callers treat as "no cache" / miss).
 * Prefers the in-memory key whenever it is set (even mid-warmup), and only
 * falls back to the legacy localStorage key before warmup completes.
 */
function getKeyBytes() {
  if (_masterKey) return _masterKey;
  if (_ready) return null;
  // Pre-warmup fallback: legacy key in localStorage (first-paint migration)
  try {
    const legacy = localStorage.getItem(localStorageKeyName());
    const k = parseKeyMaterial(legacy);
    if (k) return k;
  } catch {}
  return null;
}

// ── SHA-256 (pure JS, synchronous) ──

function sha256(message) {
  const data = message instanceof Uint8Array ? message : new TextEncoder().encode(message);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

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
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const bitLength = data.length * 8;
  const paddedLength = (((data.length + 9 + 63) / 64) | 0) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const W = new Uint32Array(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(block + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const hash = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    hash[i * 4] = (H[i] >>> 24) & 0xff;
    hash[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    hash[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    hash[i * 4 + 3] = H[i] & 0xff;
  }
  return hash;
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

// ── Key derivation ──

/**
 * Derive a per-entry key: SHA-256(masterKey || 0x00 || entryName || 0x01 || salt)
 * Domain-separation bytes prevent collisions between the segments.
 */
function deriveEntryKey(masterKey, entryName, salt) {
  const nameBytes = new TextEncoder().encode(entryName);
  const saltLen = salt ? salt.length : 0;
  const input = new Uint8Array(masterKey.length + 1 + nameBytes.length + 1 + saltLen);

  input.set(masterKey, 0);
  input[masterKey.length] = 0x00;
  input.set(nameBytes, masterKey.length + 1);

  const offset = masterKey.length + 1 + nameBytes.length;
  input[offset] = 0x01;
  if (salt) input.set(salt, offset + 1);

  return sha256(input);
}

// ── Fast storage-key hash (DJB2) ──

function hashKey(rawKey) {
  const str = STORAGE_PREFIX + rawKey;
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return STORAGE_PREFIX + Math.abs(hash).toString(36);
}

// ── Base64 helpers ──

function uint8ToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000; // 32KB — avoids RangeError on large payloads
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── Encrypt / decrypt ──

function xorCrypt(data, key) {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/**
 * Encrypt a value into the v2 format: JSON { v:2, s, c }.
 * Each write uses a fresh random salt → unique ciphertext per write.
 */
function encrypt(value, entryName) {
  const keyBytes = getKeyBytes();
  if (!keyBytes) throw new Error('SecureStorage not ready');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const entryKey = deriveEntryKey(keyBytes, entryName, salt);
  const json = JSON.stringify(value);
  const encoded = new TextEncoder().encode(json);
  const ciphertext = xorCrypt(encoded, entryKey);

  return JSON.stringify({
    v: 2,
    s: uint8ToBase64(salt),
    c: uint8ToBase64(ciphertext),
  });
}

/**
 * Decrypt a value. Supports v2 (salt) and legacy (plain base64) formats.
 */
function decrypt(raw, entryName) {
  const keyBytes = getKeyBytes();
  if (!keyBytes) throw new Error('SecureStorage not ready');

  // v2 format
  try {
    const payload = JSON.parse(raw);
    if (payload && payload.v === 2 && payload.s && payload.c) {
      const salt = base64ToUint8(payload.s);
      const entryKey = deriveEntryKey(keyBytes, entryName, salt);
      const decoded = base64ToUint8(payload.c);
      const plain = xorCrypt(decoded, entryKey);
      return JSON.parse(new TextDecoder().decode(plain));
    }
  } catch {}

  // Legacy format: plain base64 ciphertext, key derived without salt
  const entryKey = deriveEntryKey(keyBytes, entryName, null);
  const decoded = base64ToUint8(raw);
  const plain = xorCrypt(decoded, entryKey);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ── localStorage API ──

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

export function setItem(key, value) {
  try {
    const hashed = hashKey(key);
    const encrypted = encrypt(value, key);
    localStorage.setItem(hashed, encrypted);
  } catch {
    // Storage full or not ready — fail silently
  }
}

export function removeItem(key) {
  try {
    const hashed = hashKey(key);
    localStorage.removeItem(hashed);
  } catch {
    // Ignore
  }
}

export function clearAll() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
      if (k.startsWith('fc_')) toRemove.push(k); // legacy plain-text cleanup
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

export function setSessionItem(key, value) {
  try {
    const hashed = hashSessionKey(key);
    const encrypted = encrypt(value, key);
    sessionStorage.setItem(hashed, encrypted);
    return true;
  } catch {
    return false;
  }
}

export function removeSessionItem(key) {
  try {
    const hashed = hashSessionKey(key);
    sessionStorage.removeItem(hashed);
  } catch {
    // Ignore
  }
}