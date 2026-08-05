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
 * Todos los resultados se normalizan a un shape único:
 *   { provider, trackId, title, artist, album, artwork, previewUrl, externalUrl }
 */

// API de streaming del server self-hosted (yt-dlp + ffmpeg).
// Si no está disponible (Vercel / server apagado), el flujo cae a previews de 30s.
// Por defecto same-origin (/api/music, proxied a server.js en dev). Para
// apuntar a un server remoto expuesto por túnel (Termux + ngrok/cloudflared),
// define VITE_MUSIC_API_URL (p. ej. https://tu-tunel.ngrok-free.app/api/music)
// en el build del app.
const MUSIC_API = (import.meta.env.VITE_MUSIC_API_URL || '/api/music').replace(/\/+$/, '');
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

// Header para saltarse el interstitial de ngrok free en peticiones cross-origin.
// Solo se envía cuando MUSIC_API apunta a un server remoto (no same-origin).
const IS_CROSS_ORIGIN = MUSIC_API.startsWith('http');
const TUNNEL_HEADERS = IS_CROSS_ORIGIN ? { 'ngrok-skip-browser-warning': '1' } : {};

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
 * URL de stream completo de una canción (server yt-dlp).
 * Para streaming se usa conexión DIRECTA al music server (Vercel rewrites
 * no soportan respuestas de streaming largas → timeout/403).
 * El music server tiene CORS `*` así que las peticiones cross-origin funcionan.
 * Retorna null si el song no tiene artista/título.
 */
const STREAM_DIRECT_URL = (import.meta.env.VITE_MUSIC_STREAM_URL || '').replace(/\/+$/, '');

/** ¿La página se está sirviendo por HTTPS? (para detectar Mixed Content). */
const isHttpsPage = () =>
  typeof window !== 'undefined' && window.location?.protocol === 'https:';

/**
 * Base de la API del music server a usar:
 *   - En prod con túnel HTTPS automático (health.tunnelUrl) → la raíz del túnel.
 *   - Si no, same-origin (/api/music): proxy de Vite en dev, rewrites/función
 *     serverless de Vercel en prod.
 */
function getMusicApiBase(health = null) {
  const tunnel = health?.tunnelUrl;
  if (!import.meta.env.DEV && tunnel && tunnel.startsWith('https:')) {
    const b = tunnel.replace(/\/+$/, '');
    return b.endsWith('/api/music') ? b : `${b}/api/music`;
  }
  return MUSIC_API;
}

export function getStreamUrl(song, health = null) {
  if (!song?.title || !song?.artist) return null;
  const params = new URLSearchParams({ artist: song.artist, title: song.title });
  if (song.duration) params.set('duration', String(song.duration));

  // 1) URL directa configurada (VITE_MUSIC_STREAM_URL). En producción DEBE ser
  //    HTTPS: el navegador bloquea audio HTTP desde una página HTTPS (Mixed
  //    Content). Si es HTTP sobre página HTTPS se IGNORA (no se devuelve null):
  //    se cae al túnel automático o al same-origin, no al preview.
  if (STREAM_DIRECT_URL) {
    if (!isHttpsPage() || STREAM_DIRECT_URL.startsWith('https:')) {
      return `${STREAM_DIRECT_URL}/download?${params.toString()}`;
    }
    console.warn(
      '[music] VITE_MUSIC_STREAM_URL es HTTP en una página HTTPS → Mixed Content. ' +
      'Se ignora: usa el túnel automático de cloudflared (o el preview de 30s).'
    );
  }

  // 2) EN DEV: same-origin /stream a través del proxy de Vite (progresivo e
  //    instantáneo — el proxy de Vite sí maneja streams chunked). El túnel no
  //    aporta nada en local y encima ralentiza (descarga completa por el túnel).
  if (import.meta.env.DEV) {
    return `${MUSIC_API}/stream?${params.toString()}`;
  }

  // 3) EN PRODUCCIÓN: túnel HTTPS automático (cloudflared) detectado en runtime
  //    vía /health. La app usa esa URL directa (HTTPS → sin Mixed Content, sin
  //    depender de rewrites de Vercel) y sin redeploy cuando el túnel cambia.
  //    OJO: tunnelUrl es la RAÍZ del túnel (https://xxx.trycloudflare.com), el
  //    server sirve bajo /api/music → se concatena el prefijo.
  const tunnel = health?.tunnelUrl;
  if (tunnel && tunnel.startsWith('https:')) {
    return `${getMusicApiBase(health)}/download?${params.toString()}`;
  }

  // 4) Fallback same-origin en producción:
  //    - /api/music/stream: función serverless de Vercel que STREMEA en tiempo
  //      real (las functions sí soportan streaming, los rewrites no). Se
  //      activa con VITE_MUSIC_STREAM_VIA_VERCEL=1.
  //    - /api/music/download: rewrite de Vercel, archivo completo con
  //      Content-Length (lo que sí deja pasar). Default para no regresar.
  const viaVercelStream = import.meta.env.VITE_MUSIC_STREAM_VIA_VERCEL === '1';
  return `${MUSIC_API}/${viaVercelStream ? 'stream' : 'download'}?${params.toString()}`;
}

/**
 * Pre-warm: anticipa el trabajo del server para que el play arranque al
 * instante. La resolución de yt-dlp tarda 5-30s en canciones nunca escuchadas;
 * al montar la card se dispara en background:
 *   - SIEMPRE: /resolve (resuelve y cachea la URL en el server, sin descargar).
 *   - download=true (perfil propio): además pre-descarga completa → el server la
 *     deja cacheada (memoria/disco) y el play sale de caché (~1s). En perfiles
 *     ajenos NO se descarga (ahorro de banda al navegar perfiles).
 * Fire-and-forget: nunca lanza errores al llamador.
 */
export function prewarmStream(song, health = null, { download = false } = {}) {
  if (!song?.title || !song?.artist) return;
  const params = new URLSearchParams({ artist: song.artist, title: song.title });
  if (song.duration) params.set('duration', String(song.duration));
  const base = getMusicApiBase(health);

  // Resolución (parte lenta) en TODA card, cueste lo que cueste.
  fetch(`${base}/resolve?${params.toString()}`, { signal: AbortSignal.timeout(15000) }).catch(() => {});

  // Pre-descarga completa solo en producción y cuando se autoriza.
  if (!import.meta.env.DEV && download) {
    fetch(`${base}/download?${params.toString()}`, { mode: 'no-cors' }).catch(() => {});
  }
}

// ── Health del server de stream (cache en memoria, TTL 5 min) ──
let streamHealthCache = { at: 0, data: null };
const STREAM_HEALTH_TTL = 5 * 60 * 1000;

export async function getStreamHealth() {
  if (streamHealthCache.data && Date.now() - streamHealthCache.at < STREAM_HEALTH_TTL) {
    return streamHealthCache.data;
  }
  try {
    const res = await fetch(`${MUSIC_API}/health`, {
      headers: TUNNEL_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => null);
    // Se guarda el objeto COMPLETO (incluye tunnelUrl) para que el streaming
    // pueda usar el túnel HTTPS detectado en runtime.
    streamHealthCache = { at: Date.now(), data: data?.ok ? data : null };
    return streamHealthCache.data;
  } catch (err) {
    console.warn('[music] stream health check failed:', err?.message || err);
    streamHealthCache = { at: Date.now(), data: null };
    return null;
  }
}

/**
 * Busca canciones con fallback en cascada:
 *   0) Server combinado (Deezer metadatos + stream yt-dlp) — mismo origen.
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

  // 0) Server combinado (solo si responde; falla rápido si no está)
  try {
    const res = await fetch(`${MUSIC_API}/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: TUNNEL_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.success && Array.isArray(data.results)) {
        return { results: data.results, provider: 'deezer', stream: !!data.stream };
      }
    }
  } catch (err) {
    console.warn('[music] combined search failed:', err?.message || err);
  }

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

  // Candidatos en orden:
  //   1) Server de música vía MUSIC_API (/api/music/search proxy, o URL remota).
  //   2) Proxy same-origin `/api/music-search` (serverless de Vercel o
  //      server.js en dev) — fallback si el music server no está disponible.
  const trackParam = encodeURIComponent(song.trackId);
  const candidates = [
    `${MUSIC_API}/search?track=${trackParam}&provider=deezer`,
    `/api/music-search?track=${trackParam}&provider=deezer`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: TUNNEL_HEADERS,
        signal: AbortSignal.timeout(6000),
      });
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
