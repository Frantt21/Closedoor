/**
 * AlphabetEncryption — Servicio de ofuscación alfabética
 *
 * Cada letra se codifica como un palíndromo: (pos*2) + "11" + (pos*2)
 *
 * Ejemplo:
 *   "hola" → "161116" + "301130" + "241124" + "2112" = "1611163011302411242112"
 *
 * Control de acceso: se genera una clave derivada del userId del autor + userIds
 * permitidos para encriptar el contenido real con AES-256-GCM via Web Crypto API.
 * La clave NO depende del postId, lo que permite encriptar antes de crear el post.
 */

// ── Caché en memoria para contenido descifrado ──
// Evita mostrar "Descifrando..." cada vez que un PostCard se monta
const DECRYPTED_CACHE = new Map();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutos

function getCacheKey(postId, userId) {
  return `${postId}|${userId}`;
}

/**
 * Obtiene contenido descifrado del caché si existe y no ha expirado
 * @returns {string|null|undefined} - string=contenido, null=sin acceso, undefined=no en caché
 */
export function getCachedDecryptedContent(postId, userId) {
  if (!postId || !userId) return undefined;
  const key = getCacheKey(postId, userId);
  const entry = DECRYPTED_CACHE.get(key);
  if (!entry) return undefined; // undefined = no está en caché
  if (Date.now() - entry.ts > CACHE_TTL) {
    DECRYPTED_CACHE.delete(key);
    return undefined;
  }
  return entry.content; // String | null (null = no tiene acceso)
}

/**
 * Almacena contenido descifrado en el caché
 */
export function setCachedDecryptedContent(postId, userId, content) {
  if (!postId || !userId) return;
  const key = getCacheKey(postId, userId);
  DECRYPTED_CACHE.set(key, { content, ts: Date.now() });
}

/**
 * Limpia todo el caché en memoria de contenido descifrado.
 * Se llama al cerrar sesión para no dejar datos sensibles.
 */
export function clearDecryptedCache() {
  DECRYPTED_CACHE.clear();
}

// ── Mapeo letra → código palindrómico ──
const LETTER_MAP = {
  a: '2112', b: '4114', c: '6116', d: '8118',
  e: '101110', f: '121112', g: '141114', h: '161116',
  i: '181118', j: '201120', k: '221122', l: '241124',
  m: '261126', n: '281128', o: '301130', p: '321132',
  q: '341134', r: '361136', s: '381138', t: '401140',
  u: '421142', v: '441144', w: '461146', x: '481148',
  y: '501150', z: '521152',
};

// Mapeo inverso: código → letra
const CODE_MAP = {};
for (const [letter, code] of Object.entries(LETTER_MAP)) {
  CODE_MAP[code] = letter;
}

// Espacio, números y caracteres comunes extendidos
const EXTRA_MAP = {
  ' ': '0000',
  '.': '7007',
  ',': '8008',
  '!': '9009',
  '?': '10001',
  "'": '11011',
  '@': '12021',
  '#': '13031',
  $: '14041',
  '%': '15051',
  '&': '16061',
  '*': '17071',
  '-': '18081',
  '_': '19091',
  '+': '20002',
  '=': '21012',
  '/': '22022',
  ':': '23032',
  ';': '24042',
  '(': '25052',
  ')': '26062',
  '0': '27072',
  '1': '28082',
  '2': '29092',
  '3': '30003',
  '4': '31013',
  '5': '32023',
  '6': '33033',
  '7': '34043',
  '8': '35053',
  '9': '36063',
};

const REVERSE_MAP = { ...CODE_MAP };
for (const [char, code] of Object.entries(EXTRA_MAP)) {
  REVERSE_MAP[code] = char;
}

/**
 * Codifica un texto al formato de números palindrómicos
 * @param {string} text - Texto a codificar
 * @returns {string} - Cadena de números codificada
 */
export function encode(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let result = '';
  for (const char of lower) {
    const code = LETTER_MAP[char] || EXTRA_MAP[char];
    if (code) {
      result += code;
    }
  }
  return result;
}

/**
 * Decodifica una cadena de números de vuelta a texto plano
 * @param {string} encodedStr - Cadena de números codificada
 * @returns {string} - Texto decodificado
 */
export function decode(encodedStr) {
  if (!encodedStr) return '';
  let result = '';
  let i = 0;
  while (i < encodedStr.length) {
    let found = false;
    for (const len of [6, 5, 4]) {
      if (i + len <= encodedStr.length) {
        const chunk = encodedStr.slice(i, i + len);
        const char = REVERSE_MAP[chunk];
        if (char !== undefined) {
          result += char;
          i += len;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      i++;
    }
  }
  return result;
}

/**
 * Obtiene la representación ofuscada legible de un texto
 * @param {string} encodedStr
 * @param {number} maxLen
 * @returns {string}
 */
export function getObfuscatedDisplay(encodedStr, maxLen = 30) {
  if (!encodedStr) return '🔒';
  if (encodedStr.length <= maxLen) return encodedStr;
  return encodedStr.slice(0, maxLen) + '...';
}

// ── Encriptación simétrica con Web Crypto API ──

/**
 * Deriva una clave AES-GCM a partir de una semilla
 * La semilla NO depende del postId para permitir encriptar antes de crear el post
 */
async function deriveKey(seed) {
  const encoder = new TextEncoder();
  const seedData = encoder.encode(seed);
  const salt = encoder.encode('fc_alphabet_encrypt_v1');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    seedData,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encripta contenido para un conjunto de usuarios
 * La clave se deriva del userId del autor + los IDs ordenados de usuarios,
 * SIN depender del postId. Esto permite encriptar antes de crear el post.
 * @param {string} content - Contenido a encriptar
 * @param {string} authorUserId - ID del autor del post
 * @param {string[]} userIds - IDs de usuarios permitidos
 * @returns {Promise<{ciphertext: string, iv: string}>}
 */
export async function encryptForUsers(content, authorUserId, userIds) {
  const sortedIds = [...userIds].sort();
  const seed = (authorUserId || 'anon') + '|' + sortedIds.join(',');
  const key = await deriveKey(seed);

  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const ciphertext = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  const ivStr = btoa(String.fromCharCode(...iv));

  return { ciphertext, iv: ivStr };
}

/**
 * Descifra contenido si el usuario está en la lista de permitidos
 * @param {string} ciphertext - Texto cifrado en base64
 * @param {string} ivStr - IV en base64
 * @param {string} authorUserId - ID del autor del post
 * @param {string[]} allowedUserIds - IDs de usuarios permitidos
 * @param {string} currentUserId - ID del usuario actual
 * @returns {Promise<string|null>} - Contenido descifrado o null
 */
export async function decryptForUser(ciphertext, ivStr, authorUserId, allowedUserIds, currentUserId) {
  if (!allowedUserIds?.includes(currentUserId)) return null;

  const sortedIds = [...allowedUserIds].sort();
  const seed = (authorUserId || 'anon') + '|' + sortedIds.join(',');
  const key = await deriveKey(seed);

  try {
    const encrypted = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(ivStr), c => c.charCodeAt(0));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    console.warn('Decryption failed:', err);
    return null;
  }
}
