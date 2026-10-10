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
 * ⚠️ Cliente: ANDROID_VR. Verificado contra la API real desde IP de datacenter
 * (2026-10): es el único de los sondeados que devuelve playabilityStatus OK con
 * URLs directas. Referencia del sondeo:
 *   ANDROID_VR ......... OK, formatos con `url` directa
 *   WEB ................ UNPLAYABLE (requiere PO token desde datacenter)
 *   ANDROID / IOS ...... HTTP 400 (clientes retirados)
 *   TVHTML5_SIMPLY_EMBEDDED_PLAYER ... "no longer supported"
 * Por eso NO se usa WEB ni los clientes móviles: si algún día ANDROID_VR deja
 * de funcionar, hay que re-sondear clientes (el fallback natural es WEB + PO
 * token, que necesita un servicio extra).
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
// Verificado contra la API real (2026-10): ANDROID_VR e IOS devuelven
// playabilityStatus OK con URLs de audio directas. WEB queda UNPLAYABLE desde
// IP de datacenter (exige PO token), ANDROID/IOS clásicos dan HTTP 400 y
// TVHTML5_SIMPLY_EMBEDDED_PLAYER responde "no longer supported". Por eso la
// cadena es VR → IOS: si uno queda bloqueado, el otro suele pasar.
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
];

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';
const SEARCH_RESULTS_URL = 'https://www.youtube.com/results';
// UA de navegador para la página de resultados (el UA móvil de ANDROID_VR
// devuelve un HTML recortado donde no siempre está ytInitialData).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 12_000;

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
// añadirlo da 400 y quitarlo o poner `rqh=0` da 403.
//
// Consecuencia práctica: una canción de más de ~1 MiB (~65 s a 128 kbps) suena
// hasta ahí y el <audio> dispara onError → SongCard cae al preview de 30 s de
// iTunes; las canciones cortas suenan completas (verificado byte a byte).
// Levantar el tope exige PO token (un servicio extra, p. ej.
// bgutil-ytdlp-pot-provider: era lo que hacía el music server yt-dlp borrado).
// Ver README.
export const MAX_UPSTREAM_RANGE_BYTES = 1024 * 1024;

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
 */
export function pickAudioFormat(adaptiveFormats = []) {
  const audio = adaptiveFormats.filter(
    (f) => String(f.mimeType || '').startsWith('audio/') && typeof f.url === 'string'
  );
  if (audio.length === 0) return null;

  const byItag = (itag) => audio.find((f) => String(f.itag) === String(itag));
  const preferred = byItag(140) || byItag(251);
  if (preferred) return preferred;

  const m4a = audio
    .filter((f) => f.mimeType.includes('mp4'))
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return m4a[0] || audio[0];
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

async function innertubeRequest(endpoint, body, apiClient) {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
async function searchViaResultsPage(query, limit) {
  const url =
    `${SEARCH_RESULTS_URL}?search_query=${encodeURIComponent(query)}&hl=en&gl=US`;
  const res = await serialize(() =>
    fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
export async function searchTracks(query, { limit = 10, fresh = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = `${q.toLowerCase()}|${limit}`;
  if (!fresh) {
    const cached = cacheGet(searchCache, cacheKey, SEARCH_CACHE_TTL_MS);
    if (cached) return cached;
  }

  const results = await searchViaResultsPage(q, limit);
  if (results.length > 0) cacheSet(searchCache, cacheKey, results);
  return results;
}

/**
 * Resuelve un videoId a un stream de audio reproducible, probando los clientes
 * de la cadena hasta que uno responda con formatos utilizables.
 * Devuelve { url, mimeType, itag, contentLength, videoId, title, client }.
 */
export async function resolveVideoAudio(videoId) {
  if (!videoId) throw new Error('resolveVideoAudio: falta videoId');

  const failures = [];

  for (const apiClient of CLIENTS) {
    let json;
    try {
      json = await innertubeRequest(
        'player',
        { videoId, contentCheckOk: true, racyCheckOk: true },
        apiClient
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

    const format = pickAudioFormat(json?.streamingData?.adaptiveFormats);
    if (!format) {
      failures.push(`${apiClient.name}: sin formatos de audio con URL directa`);
      continue;
    }

    return {
      url: format.url,
      mimeType: String(format.mimeType || 'audio/mp4').split(';')[0],
      codecs: /codecs="([^"]+)"/.exec(format.mimeType || '')?.[1] || null,
      itag: format.itag,
      contentLength: Number(format.contentLength) || 0,
      videoId,
      title: json?.videoDetails?.title || '',
      client: apiClient.name,
    };
  }

  throw new Error(`no se pudo resolver el audio (${failures.join(' | ')})`);
}

function trackKey({ artist = '', title = '', duration = 0 }) {
  return `${normalizeText(artist)}|${normalizeText(title)}|${Math.round(duration) || 0}`;
}

/**
 * Flujo completo para una canción: buscar el videoId y resolver el audio.
 * Cachea el resultado (la resolución es lo caro y las URLs duran horas).
 *
 * @param {{ artist?: string, title: string, duration?: number, videoId?: string }} track
 * @param {{ fresh?: boolean }} [options]
 */
export async function resolveTrackAudio(track, { fresh = false } = {}) {
  const title = String(track?.title || '').trim();
  if (!title) throw new Error('resolveTrackAudio: falta title');

  const key = trackKey(track);
  if (!fresh) {
    const cached = cacheGet(streamCache, key, STREAM_CACHE_TTL_MS);
    if (cached) return { ...cached, cached: true };
  }

  let videoId = track?.videoId || null;
  if (!videoId) {
    const query = [track.artist, title].filter(Boolean).join(' ');
    const candidates = await searchTracks(query, { limit: 10, fresh });
    const best = pickBestCandidate(candidates, track);
    if (!best) throw new Error('no se encontró una coincidencia razonable en YouTube');
    videoId = best.videoId;
  }

  const resolved = await resolveVideoAudio(videoId);
  const value = { ...resolved, track: { artist: track.artist || '', title, duration: track.duration || 0 } };
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
