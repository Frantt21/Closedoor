/**
 * musicService.js — Búsqueda de canciones para la card "Mi canción" del perfil.
 *
 * Estrategia (verificada contra las APIs):
 *   1. iTunes Search API directo desde el navegador — devuelve
 *      `Access-Control-Allow-Origin: *` con peticiones de navegador y trae
 *      previewUrl (30s), artworkUrl100 (redimensionable) y trackName/artistName.
 *   2. Si falla (red/CORS/edge), fallback al proxy `/api/music-search`
 *      (función serverless de Vercel + ruta en server.js) que consulta Deezer
 *      server-side y, como último recurso, iTunes server-side.
 *
 * Stream de la canción completa: lo resuelve el backend con la API innertube
 * (YouTube) y se sirve proxyado desde el mismo origen (/api/music/stream, ver
 * api/_innertube.js). Ya no depende de ningún server externo con yt-dlp: en dev
 * lo sirve server.js y en producción la función serverless de Vercel.
 *
 * Si la resolución falla (p. ej. YouTube pidió verificación), la card cae al
 * preview de 30 s.
 *
 * Todos los resultados se normalizan a un shape único:
 *   { provider, trackId, title, artist, album, artwork, previewUrl, externalUrl }
 */

// Mismo origen siempre: proxy de Vite en dev → server.js; función serverless en
// producción. El navegador recibe el audio por HTTPS desde la propia app (sin
// Mixed Content) y nunca ve la URL de googlevideo (está firmada para la IP del
// server).
const MUSIC_API = '/api/music';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/** Escala la URL de arte de iTunes (ej. 100x100bb.jpg → 600x600bb.jpg). */
function upscaleArtwork(url, size = 600) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+(?:bb)?(?:-\d+)?\.(jpg|png)/i, `/${size}x${size}bb.$1`);
}

function normalizeItunesTrack(t) {
  if (!t?.trackName || !t?.previewUrl) return null;
  return {
    provider: 'itunes',
    trackId: String(t.trackId),
    title: t.trackName,
    artist: t.artistName || '',
    album: t.collectionName || '',
    artwork: upscaleArtwork(t.artworkUrl100),
    previewUrl: t.previewUrl,
    externalUrl: t.trackViewUrl || null,
    duration: Math.round((t.trackTimeMillis || 0) / 1000),
  };
}

/**
 * Busca en iTunes directamente desde el navegador (CORS OK).
 */
export async function searchMusicDirect(query, limit = 10) {
  const url =
    `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}` +
    `&media=music&entity=song&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map(normalizeItunesTrack).filter(Boolean);
}

/**
 * Busca a través del proxy /api/music-search (Deezer por defecto, iTunes como
 * respaldo server-side). Retorna el objeto crudo { success, provider, results }.
 */
async function searchMusicProxy(query, provider, limit) {
  const url =
    `/api/music-search?q=${encodeURIComponent(query)}` +
    `&provider=${provider}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Music proxy failed (${res.status})`);
  const data = await res.json();
  if (!data?.success || !Array.isArray(data.results)) {
    throw new Error(data?.error || 'Music proxy returned no results');
  }
  return data;
}

/**
 * URL de stream completo de una canción. Same-origin, servida por el backend
 * con innertube. La URL de googlevideo no se expone al navegador.
 * Retorna null si la canción no tiene artista/título.
 */
export function getStreamUrl(song) {
  if (!song?.title || !song?.artist) return null;
  const params = new URLSearchParams({ artist: song.artist, title: song.title });
  if (song.duration) params.set('duration', String(song.duration));
  return `${MUSIC_API}/stream?${params.toString()}`;
}

/**
 * Pre-warm: anticipa la resolución con innertube (busca el videoId y trae el
 * formato de audio) para que al pulsar play el stream arranque al instante.
 * Al montar la card se llama a /resolve, que resuelve y cachea en el server
 * SIN descargar audio.
 *
 * NO se pre-descarga el audio: descargas simultáneas desde la misma IP
 * disparan el rate-limit de googlevideo (throttling) y rompen los streams.
 * Fire-and-forget: nunca lanza errores al llamador.
 */
export function prewarmStream(song) {
  if (!song?.title || !song?.artist) return;
  const params = new URLSearchParams({ artist: song.artist, title: song.title });
  if (song.duration) params.set('duration', String(song.duration));

  fetch(`${MUSIC_API}/resolve?${params.toString()}`, { signal: AbortSignal.timeout(20000) }).catch(() => {});
}

// ── Health del stream (cache en memoria, TTL 5 min) ──
// Sirve para saber si el backend de innertube está disponible: si no lo está
// (p. ej. `vite dev` sin server.js), la card reproduce directo el preview de
// 30 s en vez de intentar un stream que va a fallar.
let streamHealthCache = { at: 0, data: null };
const STREAM_HEALTH_TTL = 5 * 60 * 1000;

export async function getStreamHealth() {
  if (streamHealthCache.data && Date.now() - streamHealthCache.at < STREAM_HEALTH_TTL) {
    return streamHealthCache.data;
  }
  try {
    const res = await fetch(`${MUSIC_API}/health`, { signal: AbortSignal.timeout(4000) });
    const data = await res.json().catch(() => null);
    streamHealthCache = { at: Date.now(), data: data?.ok ? data : null };
    return streamHealthCache.data;
  } catch (err) {
    console.warn('[music] stream health check failed:', err?.message || err);
    streamHealthCache = { at: Date.now(), data: null };
    return null;
  }
}

/**
 * Busca canciones con fallback en cascada (solo metadatos; el stream lo
 * resuelve innertube aparte):
 *   1) iTunes directo → Deezer vía proxy → iTunes vía proxy (previews 30s).
 * Devuelve { results, provider, stream? }.
 *
 * Si un proveedor respondió OK pero sin resultados, se devuelve la lista
 * vacía (para que la UI muestre "sin resultados"); solo se lanza error
 * cuando TODOS los proveedores fallaron.
 */
export async function searchMusic(query, { limit = 10 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], provider: null };

  let anySucceeded = false;

  // 1) iTunes directo (ruta rápida, sin servidor)
  try {
    const results = await searchMusicDirect(q, limit);
    anySucceeded = true;
    if (results.length) return { results, provider: 'itunes' };
  } catch (err) {
    console.warn('[music] iTunes direct failed:', err?.message || err);
  }

  // 2) Deezer vía proxy
  try {
    const proxied = await searchMusicProxy(q, 'deezer', limit);
    anySucceeded = true;
    if (proxied.results.length) return { results: proxied.results, provider: 'deezer' };
  } catch (err) {
    console.warn('[music] Deezer proxy failed:', err?.message || err);
  }

  // 3) iTunes vía proxy (último recurso, p. ej. en entornos sin CORS)
  try {
    const proxied = await searchMusicProxy(q, 'itunes', limit);
    anySucceeded = true;
    if (proxied.results.length) return { results: proxied.results, provider: 'itunes' };
  } catch (err) {
    console.warn('[music] iTunes proxy failed:', err?.message || err);
  }

  if (anySucceeded) return { results: [], provider: null };
  throw new Error('Music search failed');
}

// ── Preview fresco (los de Deezer expiran ≈ 15 min) ──
// Caché con TTL ~10 min (menor que la expiración real): una URL cacheada
// nunca se sirve ya muerta en la misma sesión.
const resolvedPreviewCache = new Map(); // key → { url, at }
const RESOLVED_PREVIEW_TTL = 10 * 60 * 1000;

/**
 * Resuelve la URL de preview VÁLIDA para un song guardado.
 * - iTunes: los previews son estables → se devuelve el guardado.
 * - Deezer: expiran → se re-consulta vía proxy (?track=) y se cachea en memoria.
 * Si la resolución falla, se devuelve la URL guardada como último recurso.
 */
export async function resolvePreviewUrl(song) {
  if (!song?.previewUrl) return null;
  if (song.provider !== 'deezer' || !song.trackId) return song.previewUrl;

  const key = `deezer:${song.trackId}`;
  const hit = resolvedPreviewCache.get(key);
  if (hit && Date.now() - hit.at < RESOLVED_PREVIEW_TTL) return hit.url;
  resolvedPreviewCache.delete(key); // entrada expirada → liberar

  // Proxy same-origin `/api/music-search` (función serverless de Vercel, o ruta
  // de server.js en dev): los previews de Deezer expiran cada ~15 min.
  const trackParam = encodeURIComponent(song.trackId);
  const candidates = [`/api/music-search?track=${trackParam}&provider=deezer`];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.success && data.previewUrl) {
        resolvedPreviewCache.set(key, { url: data.previewUrl, at: Date.now() });
        return data.previewUrl;
      }
    } catch (err) {
      console.warn('[music] preview resolve failed:', err?.message || err);
    }
  }

  return song.previewUrl;
}
