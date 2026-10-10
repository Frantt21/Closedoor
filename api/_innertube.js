/**
 * api/_innertube.js — Resolución de streams de audio con la API innertube
 * (la API interna que usa el propio cliente de YouTube). Reemplaza a yt-dlp:
 * no requiere binarios ni servidor propio, así que corre también en serverless.
 *
 * Cómo funciona:
 *   1. search  → PÁGINA /results (ytInitialData): encuentra el videoId de
 *                "artista - título". ⚠️ NO se usa youtubei/v1/search a
 *                propósito: verificado que un search de innertube ENVENENA el
 *                player siguiente desde la misma IP (el player pasa a
 *                LOGIN_REQUIRED "Sign in to confirm you're not a bot"),
 *                mientras que con la búsqueda por HTML el player responde OK.
 *   2. player  → youtubei/v1/player: devuelve `streamingData.adaptiveFormats`
 *                con la URL directa del audio.
 *   3. match   → se elige el mejor candidato por similitud de título/artista y
 *                por DURACIÓN (evita covers, remixes y versiones en vivo).
 *
 * ⚠️ Clientes: cadena ANDROID_VR → IOS → ANDROID (ver CLIENTS). Sobre el
 * sondeo real (2026-10-10): los tres devuelven playabilityStatus OK con URLs
 * directas (ANDROID_VR a veces LOGIN_REQUIRED según el momento), WEB y los
 * clientes de música quedan UNPLAYABLE / LOGIN_REQUIRED. ANDROID va último
 * porque es el único que expone los itags de baja calidad (599 = 32 kbps) con
 * los que una canción larga cabe entera en el tramo que entrega el CDN. Si
 * algún día todos dejan de funcionar, hay que re-sondear clientes (el fallback
 * natural es WEB + PO token, que necesita un servicio extra).
 *
 * ⚠️ Las URLs de googlevideo están atadas a la IP que las resolvió y expiran
 * (~6 h). Por eso el frontend nunca las recibe: se proxian desde el server
 * (ver api/music/stream.js) y se cachean acá con TTL conservador.
 *
 * ⚠️ Legal/ToS: extraer streams completa de YouTube va contra sus términos de
 * servicio; queda bajo tu criterio en tu infraestructura.
 */

// Clientes innertube soportados, en orden de preferencia. Las claves son las
// públicas que llevan las apps en el APK/IPA (no son secretos).
//
// Sondeo contra la API real (2026-10-10, mismo vídeo y misma IP):
//   ANDROID_VR ......... OK o LOGIN_REQUIRED según el momento · sólo 139/140
//   IOS ................ OK · sólo 139/140
//   ANDROID ............ OK · expone además los itags de BAJA calidad
//                        (599 = 32 kbps m4a, 600 = opus), que son los únicos
//                        que permiten que una canción larga quepa ENTERA en el
//                        tramo servible (MAX_UPSTREAM_RANGE_BYTES)
//   ANDROID_MUSIC / IOS_MUSIC ... LOGIN_REQUIRED ("Please sign in")
//   WEB_REMIX / MWEB ... UNPLAYABLE · WEB ... UNPLAYABLE (PO token)
//   TVHTML5_SIMPLY_EMBEDDED_PLAYER ... "no longer supported"
// Orden VR → IOS → ANDROID: los dos primeros dan mejor audio y ANDROID se
// consulta sólo si ninguno ofrece un formato que quepa entero.
const CLIENTS = [
  {
    name: 'ANDROID_VR',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip',
    client: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      androidSdkVersion: 32,
      deviceModel: 'Quest 3',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    name: 'IOS',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X)',
    client: {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceModel: 'iPhone16,2',
      hl: 'en',
      gl: 'US',
    },
  },
  // Último recurso: es el único cliente que expone los itags de baja calidad
  // (599/600) con los que una canción larga entra entera en el tramo servible.
  {
    name: 'ANDROID',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    client: {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      androidSdkVersion: 34,
      hl: 'en',
      gl: 'US',
    },
  },
];

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';
const SEARCH_RESULTS_URL = 'https://www.youtube.com/results';
// UA de navegador para la página de resultados (el UA móvil de ANDROID_VR
// devuelve un HTML recortado donde no siempre está ytInitialData).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
// Timeout por paso contra YouTube. En serverless (Vercel) esto lo paga el reloj
// de la función: un paso que no contesta razonablemente rápido está muerto, y
// esperar 12 s sólo sirve para reventar el límite de la plataforma (504).
const REQUEST_TIMEOUT_MS = 7_000;

// Presupuesto TOTAL de una resolución (búsqueda + cadena de clientes). Con esto
// el handler decide él mismo cuándo rendirse (y responde un error legible) en
// lugar de que la plataforma lo mate con un 504 a los 60 s.
const RESOLVE_BUDGET_MS = 25_000;
// Mensaje único del timeout: los handlers lo usan para responder 504 en vez de
// 502 (ver isResolveTimeout).
const RESOLVE_TIMEOUT_MESSAGE = 'no se pudo resolver el audio a tiempo (timeout)';
// Margen mínimo para intentar otro cliente: por debajo de esto no se arranca uno
// nuevo (es mejor devolver lo que ya se tenga).
const MIN_CLIENT_BUDGET_MS = 2_500;

/**
 * Control de tiempo para una operación con presupuesto.
 * @param {number} budgetMs Milisegundos disponibles.
 */
function deadlineGuard(budgetMs) {
  const deadline = Date.now() + Math.max(1_000, budgetMs);
  return {
    remaining: () => deadline - Date.now(),
    expired: () => Date.now() >= deadline,
    // Timeout para el siguiente paso: nunca más que lo que queda de presupuesto.
    timeoutFor: (max) => Math.max(1_000, Math.min(max, deadline - Date.now())),
  };
}

// TTL de la caché de resolución. Las URLs de googlevideo viven ~6 h; se guarda
// 2 h para no servir nunca una URL vencida en una sesión larga.
const STREAM_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
// Igual que el music server anterior: resolver es la parte lenta, así que se
// cachea también la BÚSQUEDA (qué videoId corresponde a cada canción).
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

// ── Cachés en memoria del proceso serverless ──
const streamCache = new Map(); // key → { value, at }
const searchCache = new Map(); // key → { value, at }

function cacheGet(cache, key, ttl) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(cache, key, value) {
  cache.set(key, { value, at: Date.now() });
  // Poda FIFO simple: el Map conserva el orden de inserción.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// ── Rango de la petición al CDN de googlevideo ──
// Medido contra la API real (2026-10): las URLs de innertube llevan `rqh=1`
// ("range query") y el CDN responde **403** a cualquier petición cuyo final
// pase de ~1 MiB, y también a los rangos abiertos (`Range: bytes=0-`, que es
// justo lo que manda el navegador al arrancar el <audio>) porque un rango
// abierto implica un final = tamaño del archivo.
//
// Por eso el proxy NUNCA reenvía el rango del cliente tal cual: pide siempre un
// bloque ACOTADO (1 MiB) desde el offset pedido. El navegador recibe un 206 con
// `Content-Range` real y sigue pidiendo el resto por su cuenta, como cualquier
// medio progresivo.
//
// ⚠️ Tope real medido (2026-10, IP residencial Y de datacenter, con ANDROID_VR
// y con IOS): con `rqh=1` el CDN entrega **sólo el primer MiB del archivo**. La
// medida es posicional y absoluta, no de tamaño: en la misma URL,
// `bytes=0-1048575` y `bytes=1000000-1048575` dan 206, pero `bytes=1048576-…`
// da 403 — incluso en la PRIMERA petición de una URL recién resuelta desde una
// IP residencial. La URL tampoco lleva un param `range` que reescribir:
// añadirlo con un rango fuera del MiB firmado da 416 (`&range=1048576-2097151`),
// con rango abierto da 403, y quitarlo o poner `rqh=0` da 403 (re-verificado
// 2026-10-10 con una URL recién resuelta: el CDN acepta sólo 0-1048575).
//
// Consecuencia práctica (medida con un navegador real, 2026-10-10): el <audio>
// de Chrome NO espera a consumir el buffer — pide la continuación
// (`Range: bytes=1048576-`) en paralelo al arrancar, y el 502 de esa petición
// mata el pipeline entero (PIPELINE_ERROR_READ a los ~1,5 s, con 64 s ya en
// buffer). Por eso:
//   1. el resolver elige, si existe, un formato cuya pista ENTERA quepa en el
//      tramo servible (itag 599 = 32 kbps m4a suele caber incluso en canciones
//      de 3-4 min) → la canción suena completa, con menos calidad;
//   2. si ninguno cabe, se sirve el formato MUXED (itag 18), cuyas URLs NO
//      están limitadas por rango (ver pickMuxedFormat) → la canción suena
//      entera. Si la pista no tiene muxed con URL, marca `playable: false` y la
//      card reproduce directo el preview de 30 s en vez de un stream condenado.
//
// 📌 Idea tomada del proyecto Scrup (ytdownloader): el audio-only va "gated"
// (su URL caduca/limita), el muxed no. Scrup además lo pide con el cliente
// ANDROID; aquí se usa ANDROID como ÚLTIMO cliente de la cadena porque es el
// único de los sondeados que devuelve a la vez audio-only (139/140/249/251/599/
// 600) y muxed (18) con URL directa: IOS no expone muxed y ANDROID 21.x sirve el
// audio cifrado (sin URL), que es lo que obliga a Scrup a usar sólo el muxed.
// ⚠️ El presupuesto por URL no es constante: medido (2026-10-10) que tras mucho
// sondeo desde la misma IP una URL fresca entregaba sólo ~300 KB en trozos de
// 100 KB y devolvía 403 a peticiones mayores, sin recuperarse al esperar
// (token-bucket por IP). Si el CDN rechaza el bloque, el proxy responde 502 en
// la primera petición y la card cae al preview sin dejar audio a medias.
// Levantar el tope exige PO token (un servicio extra, p. ej.
// bgutil-ytdlp-pot-provider: era lo que hacía el music server yt-dlp borrado).
// Ver README.
export const MAX_UPSTREAM_RANGE_BYTES = 1024 * 1024;

// Margen para distinguir "URL caducada" de "el CDN no da más": las URLs de
// googlevideo viven ~6 h, así que un 403 a los pocos minutos de resolverla no es
// caducidad (ver urlMayBeExpired).
export const STREAM_URL_FRESH_MS = 5 * 60 * 1000;

/**
 * ¿Merece la pena re-resolver porque la URL pudo caducar?
 *
 * Un 403/410 en el primer bloque de una URL recién resuelta NO es caducidad:
 * es el allowance del CDN por URL (ver MAX_UPSTREAM_RANGE_BYTES). En ese caso
 * re-resolver gasta una llamada al player y ~1-2 s antes de dar el mismo 502.
 *
 * @param {{resolvedAt?: number}} resolved Resolución (`resolvedAt` en ms).
 * @param {number} [nowMs] Instante actual (inyectable para tests).
 * @returns {boolean} true si puede estar caducada (o si no se sabe: conservador).
 */
export function urlMayBeExpired(resolved, nowMs = Date.now()) {
  const at = Number(resolved?.resolvedAt) || 0;
  if (!at) return true; // sin marca de tiempo no se puede descartar la caducidad
  return nowMs - at > STREAM_URL_FRESH_MS;
}

/**
 * Convierte el `Range` del cliente en el rango acotado que se le pide a
 * googlevideo.
 *
 * @param {string|null|undefined} clientRange Rango pedido por el navegador.
 * @param {number} [contentLength] Tamaño real del audio (para no pedir de más).
 * @returns {string|null} `bytes=a-b` acotado, o null si el rango cae fuera del
 *   archivo (el proxy debe responder 416).
 */
export function upstreamRangeHeader(clientRange, contentLength = 0) {
  const chunk = MAX_UPSTREAM_RANGE_BYTES;
  const firstChunk = `bytes=0-${chunk - 1}`;
  // Sin Range (o multipart/formatos raros): basta el primer bloque, el navegador
  // seguirá pidiendo el resto.
  if (!clientRange) return firstChunk;

  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(clientRange).trim());
  if (!match) return firstChunk;

  const start = Number(match[1]);
  const askedEnd = match[2] === '' ? start + chunk - 1 : Number(match[2]);
  // Nunca más de un bloque, y nunca más allá del final del archivo.
  let end = Math.min(askedEnd, start + chunk - 1);
  if (contentLength > 0) end = Math.min(end, contentLength - 1);

  if (end < start) return null; // pide empezar más allá del archivo → 416
  return `bytes=${start}-${end}`;
}

// ── Helpers de texto para el matching ──
// Palabras que aparecen en títulos de YouTube y ensucian la comparación.
const NOISE_WORDS =
  /(official|oficial|video|videoclip|audio|lyric|lyrics|letra|hd|hq|4k|remaster(ed)?|mv|m\/v|visualizer|prod\.?|explicit|full|album|version)/gi;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // quita "(Official Video)", "[HD]"
    .replace(NOISE_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // quita puntuación (conserva acentos)
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalizeText(text).split(' ').filter(Boolean);
}

/** Similitud simple de conjuntos de palabras (0..1). */
function similarity(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

/** "3:32" / "1:02:03" → segundos. */
export function parseDuration(text) {
  if (!text) return 0;
  const parts = String(text)
    .replace(/[^\d:]/g, '')
    .split(':')
    .map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Puntúa un candidato contra la canción buscada. La duración manda: es el
 * filtro que descarta covers, remixes y directos.
 */
export function scoreCandidate(candidate, track) {
  const { artist = '', title = '', duration = 0 } = track || {};
  const candTitle = candidate.title || '';
  const candChannel = candidate.channel || '';

  let score = 0;
  score += similarity(title, candTitle) * 0.55;
  score += similarity(`${artist} ${title}`, candTitle) * 0.25;
  if (artist) score += similarity(artist, candChannel) * 0.1;

  if (duration > 0 && candidate.durationSec > 0) {
    const diff = Math.abs(candidate.durationSec - duration);
    // ±4 s se considera el mismo track; después cae rápido.
    if (diff <= 4) score += 0.35;
    else if (diff <= 10) score += 0.15;
    else if (diff > 30) score -= 0.45;
  }
  return score;
}

/** Elige el mejor candidato (o null si ninguno supera el mínimo). */
export function pickBestCandidate(candidates, track) {
  let best = null;
  let bestScore = 0;
  for (const cand of candidates) {
    const score = scoreCandidate(cand, track);
    if (score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  // Umbral: evita devolver cualquier cosa cuando la búsqueda no encontró nada
  // parecido (mejor 404 en el stream que reproducir una canción equivocada).
  return bestScore >= 0.45 ? best : null;
}

/**
 * Elige el formato de audio con mejor relación compatibilidad/tamaño.
 * Orden: m4a 140 (131 kbps, lo reproduce todo) > opus 251 (mejor calidad pero
 * Safari no lo decodifica) > el m4a disponible con más bitrate > el primero.
 *
 * @param {Array} adaptiveFormats Formatos del player (streamingData).
 * @param {{ maxBytes?: number }} [options] Con `maxBytes` sólo se eligen
 *   formatos cuya pista ENTERA quepa en ese tamaño (el CDN con `rqh=1` sólo
 *   entrega el primer MiB de cada URL: ver MAX_UPSTREAM_RANGE_BYTES). Se
 *   prefiere perder calidad antes que no poder oír la canción completa:
 *   140 → el mejor m4a que quepa → el mejor opus que quepa (Safari no lo
 *   decodifica, así que va último). Si NINGUNO cabe, devuelve la elección
 *   normal y es el llamador quien marca `playable: false`.
 */
export function pickAudioFormat(adaptiveFormats = [], { maxBytes = 0 } = {}) {
  const audio = adaptiveFormats.filter(
    (f) => String(f.mimeType || '').startsWith('audio/') && typeof f.url === 'string'
  );
  if (audio.length === 0) return null;

  const byItag = (itag) => audio.find((f) => String(f.itag) === String(itag));
  const byBitrate = (list) =>
    [...list].sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  // Sin tamaño declarado no se puede garantizar que quepa: se descarta.
  const fits = (f) => Number(f.contentLength) > 0 && Number(f.contentLength) <= maxBytes;
  const m4a = byBitrate(audio.filter((f) => f.mimeType.includes('mp4')));

  const preferred = byItag(140) || byItag(251);
  if (preferred && (maxBytes <= 0 || fits(preferred))) return preferred;

  if (maxBytes > 0) {
    const m4aFits = m4a.find(fits);
    if (m4aFits) return m4aFits;
    const anyFits = byBitrate(audio).find(fits);
    if (anyFits) return anyFits;
  }

  return preferred || m4a[0] || audio[0];
}

// ── Llamadas a innertube ──
// ⚠️ NO enviar `visitorData` en el contexto. Verificado empíricamente: con un
// visitorData obtenido de un search, el player responde LOGIN_REQUIRED
// ("Sign in to confirm you're not a bot"); sin él, el mismo video responde OK.
// (El cliente real sí lo manda, pero acá, sin sesión de usuario ni PO token, el
// visitorData juega en contra.)

// Antirráfaga: innertube castiga varias llamadas simultáneas desde una misma
// IP. Las peticiones se encadenan para no solaparse.
let requestChain = Promise.resolve();

function serialize(fn) {
  const run = requestChain.then(fn, fn);
  // La cadena no debe romperse si una llamada falla.
  requestChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function innertubeRequest(endpoint, body, apiClient, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url = `${INNERTUBE_BASE}/${endpoint}?key=${apiClient.key}&prettyPrint=false`;

  const res = await serialize(() =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': apiClient.userAgent,
        Origin: 'https://www.youtube.com',
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify({ context: { client: apiClient.client }, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  );
  if (!res.ok) throw new Error(`${apiClient.name} HTTP ${res.status}`);
  return res.json();
}

// El cliente ANDROID_VR devuelve `compactVideoRenderer` (no `videoRenderer`,
// que es lo que usa WEB). Se soportan ambos por si cambia el cliente.
const VIDEO_RENDERER_KEYS = ['videoRenderer', 'compactVideoRenderer'];

function textOf(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('');
  return '';
}

/** ytInitialData de /results no trae lengthSeconds: la duración viene en
 *  `lengthText` ("3:34"). Se soportan las dos formas. */
function durationOf(renderer) {
  if (renderer.lengthSeconds) return Number(renderer.lengthSeconds) || 0;
  return parseDuration(textOf(renderer.lengthText));
}

/** Recorre el árbol de respuesta juntando los videos del search. */
function collectVideoRenderers(node, out, seen) {
  if (!node || typeof node !== 'object') return out;

  for (const key of VIDEO_RENDERER_KEYS) {
    const v = node[key];
    if (v?.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({
        videoId: v.videoId,
        title: textOf(v.title),
        channel: textOf(v.ownerText) || textOf(v.longBylineText) || textOf(v.shortBylineText),
        durationSec: durationOf(v),
      });
    }
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') collectVideoRenderers(value, out, seen);
  }
  return out;
}

/**
 * Búsqueda por la página de resultados (ytInitialData).
 * Devuelve candidatos normalizados { videoId, title, channel, durationSec }.
 */
async function searchViaResultsPage(query, limit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const url =
    `${SEARCH_RESULTS_URL}?search_query=${encodeURIComponent(query)}&hl=en&gl=US`;
  const res = await serialize(() =>
    fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  );
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);

  const html = await res.text();
  const match = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  if (!match) throw new Error('no se pudo leer la búsqueda de YouTube');

  const data = JSON.parse(match[1]);
  return collectVideoRenderers(data, [], new Set()).slice(0, limit);
}

/**
 * Busca videos en YouTube.
 *
 * ⚠️ Usa la página /results y NO youtubei/v1/search: el search de innertube
 * deja marcada la sesión y el player siguiente responde LOGIN_REQUIRED.
 */
export async function searchTracks(query, { limit = 10, fresh = false, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = `${q.toLowerCase()}|${limit}`;
  if (!fresh) {
    const cached = cacheGet(searchCache, cacheKey, SEARCH_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const results = await searchViaResultsPage(q, limit, timeoutMs);
  if (results.length > 0) cacheSet(searchCache, cacheKey, results);
  return results;
}

/**
 * Resuelve un videoId a un stream de audio reproducible, probando los clientes
 * de la cadena hasta que uno responda con formatos utilizables.
 *
 * Elige el formato que quepa ENTERO en el tramo que entrega el CDN
 * (MAX_UPSTREAM_RANGE_BYTES). Devuelve:
 *   { url, mimeType, codecs, itag, contentLength, videoId, title, client,
 *     playable, degraded }
 * donde `playable: false` significa que la pista es más grande que el tramo
 * servible → la card debe usar el preview de 30 s, y `degraded: true` que se
 * bajó de calidad para que la canción sí quepa completa.
 */
export async function resolveVideoAudio(videoId, { budgetMs = 0 } = {}) {
  if (!videoId) throw new Error('resolveVideoAudio: falta videoId');

  // Presupuesto opcional: sin él se comporta como antes (un intento por
  // cliente); con él, la cadena se corta cuando se agota para no reventar el
  // reloj de la función serverless que la llamó.
  const guard = budgetMs > 0 ? deadlineGuard(budgetMs) : null;
  const failures = [];
  // true si la cadena se cortó por presupuesto (no por fallos de YouTube).
  let budgetCut = false;
  // Primera resolución utilizable aunque la pista NO quepa entera: se devuelve
  // sólo si ningún cliente ofrece un formato que sí quepa (playable:false → la
  // card reproduce el preview de 30 s en vez de un stream condenado).
  let tooBig = null;

  for (const apiClient of CLIENTS) {
    // Sin presupuesto suficiente no se arranca otro cliente: es preferible
    // devolver lo que ya se tenga (tooBig) o fallar rápido.
    if (guard && (guard.expired() || guard.remaining() < MIN_CLIENT_BUDGET_MS)) {
      budgetCut = true;
      break;
    }

    let json;
    try {
      json = await innertubeRequest(
        'player',
        { videoId, contentCheckOk: true, racyCheckOk: true },
        apiClient,
        guard ? guard.timeoutFor(REQUEST_TIMEOUT_MS) : REQUEST_TIMEOUT_MS
      );
    } catch (err) {
      failures.push(`${apiClient.name}: ${err.message}`);
      continue;
    }

    const status = json?.playabilityStatus?.status;
    if (status && status !== 'OK') {
      const reason = json?.playabilityStatus?.reason || `no reproducible (${status})`;
      // LOGIN_REQUIRED = YouTube pidió verificación para esta IP/cliente. Se
      // prueba el siguiente cliente; si todos fallan, el error lo dice.
      failures.push(`${apiClient.name}: ${reason}`);
      continue;
    }

    const formats = json?.streamingData?.adaptiveFormats;
    const best = pickAudioFormat(formats);
    const muxed = pickMuxedFormat(json?.streamingData?.formats);
    // 1º) el mejor audio-only cuya pista ENTERA quepa en el tramo servible (el
    //     archivo más pequeño). 2º) si no cabe, el muxed, que no está limitado
    //     por rango → la canción suena entera (ver pickMuxedFormat).
    const audioOnly = pickAudioFormat(formats, { maxBytes: MAX_UPSTREAM_RANGE_BYTES });
    const audioOnlyLength = Number(audioOnly?.contentLength) || 0;
    const audioOnlyFits = audioOnlyLength > 0 && audioOnlyLength <= MAX_UPSTREAM_RANGE_BYTES;
    const format = audioOnlyFits || !muxed ? audioOnly : muxed;
    if (!format) {
      failures.push(`${apiClient.name}: sin formatos de audio con URL directa`);
      continue;
    }
    const isMuxed = format === muxed;

    const contentLength = Number(format.contentLength) || 0;
    const entry = {
      url: format.url,
      mimeType: String(format.mimeType || 'audio/mp4').split(';')[0],
      codecs: /codecs="([^"]+)"/.exec(format.mimeType || '')?.[1] || null,
      itag: format.itag,
      contentLength,
      videoId,
      title: json?.videoDetails?.title || '',
      client: apiClient.name,
      // El muxed siempre es servible entero; el audio-only sólo si cabe en el
      // tramo que el CDN entrega de una URL.
      playable: isMuxed || (contentLength > 0 && contentLength <= MAX_UPSTREAM_RANGE_BYTES),
      // true si hubo que bajar de calidad (itag distinto al mejor disponible)
      degraded: !!best && String(best.itag) !== String(format.itag),
      // Red de seguridad del audio-only: si el CDN rechaza su primer bloque
      // (403 = allowance de la URL agotado) el stream se sirve desde el muxed.
      fallbackUrl: isMuxed ? null : muxed?.url || null,
      fallbackLength: isMuxed ? 0 : Number(muxed?.contentLength) || 0,
    };

    // Si cabe ENTERA es la buena y no se consulta a los demás clientes.
    if (entry.playable) return entry;
    // Si no cabe se prueba el siguiente cliente (ANDROID expone los itags de
    // baja calidad, VR/IOS no) antes de rendirse con esta.
    if (!tooBig) tooBig = entry;
  }

  if (tooBig) return tooBig;
  // Se agotó el presupuesto (o no quedaba margen para otro cliente) y no hay
  // nada utilizable: el error honesto es el timeout, no "todos los clientes
  // fallaron".
  if (guard?.expired() || budgetCut) throw new Error(RESOLVE_TIMEOUT_MESSAGE);
  throw new Error(`no se pudo resolver el audio (${failures.join(' | ')})`);
}

/**
 * Formato MUXED (vídeo+áudio en un MP4 progresivo): itag 18 = 360p con AAC
 * ~128 kbps. No es ideal en ancho de banda, pero es la ÚNICA vía fiable de
 * servir una canción larga entera: verificado (2026-10-10, IP residencial y de
 * datacenter con el cliente ANDROID) que sus URLs sirven CUALQUIER offset —
 * incluidas posiciones de 3, 5 y 12 MB de un archivo de 13 MB — mientras las
 * URLs audio-only (adaptive) devuelven 403 en cuanto el CDN agota el allowance
 * de esa URL. Es la idea que usa el proyecto Scrup (ytdownloader): el audio-only
 * va "gated", el muxed no.
 *
 * Orden: itag 18 (el más ligero: ~496 kbps totales) → itag 22 (720p) → el de
 * menor bitrate. Los formatos sin `url` directa (firmados/cipher) se descartan.
 */
export function pickMuxedFormat(streamingFormats = []) {
  const muxed = streamingFormats.filter(
    (f) => typeof f.url === 'string' && String(f.mimeType || '').startsWith('video/')
  );
  if (muxed.length === 0) return null;

  const byItag = (itag) => muxed.find((f) => String(f.itag) === String(itag));
  return (
    byItag(18) ||
    byItag(22) ||
    [...muxed].sort((a, b) => Number(a.bitrate || 0) - Number(b.bitrate || 0))[0]
  );
}

/**
 * Marca la resolución cacheada de una pista para que el stream use el muxed
 * (`fallbackUrl`) en vez del audio-only. Queda *sticky* en la caché del proceso:
 * el CDN ya dijo que no da más de esa URL, así que los siguientes bloques y los
 * seek deben leer el MISMO archivo (y el mismo espacio de offsets).
 *
 * @param {{artist?: string, title: string, duration?: number}} track
 * @returns {boolean} true si la pista tenía fallback y quedó marcada.
 */
/**
 * Fuente activa de una resolución: el MUXED (`fallbackUrl`) si ya se cayó a él,
 * si no el formato elegido. El muxed es OTRO archivo (más grande), así que
 * devuelve también su tamaño: los offsets que pida el cliente pasan a ser los
 * suyos y el `Content-Range` que se le reenvía es el del archivo servido.
 *
 * @param {{url: string, contentLength?: number, fallbackUrl?: string|null, fallbackLength?: number, useFallback?: boolean}} resolved
 */
export function activeStreamSource(resolved) {
  if (resolved?.useFallback && resolved?.fallbackUrl) {
    return { url: resolved.fallbackUrl, contentLength: resolved.fallbackLength || 0 };
  }
  return { url: resolved?.url, contentLength: resolved?.contentLength || 0 };
}

/**
 * ¿El error de una resolución es un agotamiento del presupuesto de tiempo?
 * (para que los handlers respondan 504 en vez de 502).
 */
export function isResolveTimeout(err) {
  return /a tiempo \(timeout\)/.test(err?.message || '');
}

export function markStreamFallback(track) {
  const hit = streamCache.get(trackKey(track));
  if (!hit?.value?.fallbackUrl) return false;
  hit.value.useFallback = true;
  return true;
}

function trackKey({ artist = '', title = '', duration = 0 }) {
  return `${normalizeText(artist)}|${normalizeText(title)}|${Math.round(duration) || 0}`;
}

/**
 * Flujo completo para una canción: buscar el videoId y resolver el audio.
 * Cachea el resultado (la resolución es lo caro y las URLs duran horas).
 *
 * @param {{ artist?: string, title: string, duration?: number, videoId?: string }} track
 * @param {{ fresh?: boolean, budgetMs?: number }} [options]
 */
export async function resolveTrackAudio(track, { fresh = false, budgetMs = RESOLVE_BUDGET_MS } = {}) {
  const title = String(track?.title || '').trim();
  if (!title) throw new Error('resolveTrackAudio: falta title');

  const key = trackKey(track);
  if (!fresh) {
    const cached = cacheGet(streamCache, key, STREAM_CACHE_TTL_MS);
    if (cached) return { ...cached, cached: true };
  }

  // Todo el trabajo (búsqueda + cadena de clientes) comparte un presupuesto: el
  // handler serverless prefiere responder un 504 suyo y legible antes que morir
  // con el 504 de la plataforma tras 60 s de espera (el usuario ve el preview
  // en ambos casos, pero aquí en segundos y con un motivo en el cuerpo).
  const guard = deadlineGuard(budgetMs);

  let videoId = track?.videoId || null;
  if (!videoId) {
    const query = [track.artist, title].filter(Boolean).join(' ');
    let candidates;
    try {
      candidates = await searchTracks(query, {
        limit: 10,
        fresh,
        timeoutMs: guard.timeoutFor(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Un paso abortado por el presupuesto sale como timeout legible (504 en el
      // handler) en lugar del error crudo de undici ("operation was aborted").
      const aborted = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      if (aborted || guard.expired()) throw new Error(RESOLVE_TIMEOUT_MESSAGE, { cause: err });
      throw err;
    }
    if (guard.expired()) throw new Error(RESOLVE_TIMEOUT_MESSAGE);
    const best = pickBestCandidate(candidates, track);
    if (!best) throw new Error('no se encontró una coincidencia razonable en YouTube');
    videoId = best.videoId;
  }

  const resolved = await resolveVideoAudio(videoId, { budgetMs: guard.remaining() });
  const value = {
    ...resolved,
    // Cuándo se resolvió: permite distinguir "URL caducada" de "el CDN no da
    // más audio de esta IP" cuando el primer bloque responde 403 (ver
    // urlMayBeExpired).
    resolvedAt: Date.now(),
    track: { artist: track.artist || '', title, duration: track.duration || 0 },
  };
  cacheSet(streamCache, key, value);
  return value;
}

/** Estado del resolver (para /api/music/health). */
export function getInnertubeInfo() {
  return {
    provider: 'innertube',
    clients: CLIENTS.map((c) => `${c.name} ${c.client.clientVersion}`),
    cachedSearches: searchCache.size,
    cachedStreams: streamCache.size,
  };
}

/** Solo para tests/diagnóstico: limpia las cachés. */
export function clearInnertubeCaches() {
  streamCache.clear();
  searchCache.clear();
}
