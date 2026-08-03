/**
 * Lógica compartida de búsqueda de música (Deezer / iTunes) usada por:
 *   - api/music-search.js   → función serverless de Vercel
 *   - server.js             → ruta local /api/music-search (dev/self-hosted)
 *
 * Todas las llamadas son server-side (sin CORS) y devuelven un arreglo de
 * tracks NORMALIZADOS con el mismo shape que usa el frontend (musicService):
 *   { provider, trackId, title, artist, album, artwork, previewUrl, externalUrl }
 */

const UA = 'Mozilla/5.0 (compatible; FastChangeBot/1.0)';

/** Escala la URL de arte de iTunes (ej. 100x100bb.jpg → 600x600bb.jpg). */
function upscaleItunesArtwork(url, size = 600) {
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
    artwork: upscaleItunesArtwork(t.artworkUrl100),
    previewUrl: t.previewUrl,
    externalUrl: t.trackViewUrl || null,
    duration: Math.round((t.trackTimeMillis || 0) / 1000),
  };
}

/** Escala la URL de arte de Deezer (250px → 500px, nítido en el vinilo). */
function upscaleDeezerArtwork(url, size = 500) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+-/i, `/${size}x${size}-`);
}

function normalizeDeezerTrack(t) {
  if (!t?.title || !t?.preview) return null;
  return {
    provider: 'deezer',
    trackId: String(t.id),
    title: t.title,
    artist: t.artist?.name || '',
    album: t.album?.title || '',
    // cover_medium (250px) → upscale a 500px para el disco y las miniaturas
    artwork: upscaleDeezerArtwork(t.album?.cover_medium || t.album?.cover_small) || null,
    previewUrl: t.preview,
    externalUrl: t.link || null,
    duration: t.duration || 0,
  };
}

async function fetchItunes(query, limit) {
  const url =
    'https://itunes.apple.com/search' +
    `?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`iTunes search failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map(normalizeItunesTrack).filter(Boolean);
}

async function fetchDeezer(query, limit) {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Deezer search failed (${res.status})`);
  const data = await res.json();
  return (data.data || []).map(normalizeDeezerTrack).filter(Boolean);
}

/**
 * Busca canciones server-side y devuelve tracks normalizados.
 * @param {string} query - Término de búsqueda
 * @param {'deezer'|'itunes'} provider - Proveedor a consultar
 * @param {number|string} [limit] - Límite de resultados (máx 25)
 */
export async function searchMusicServer(query, provider = 'deezer', limit = 10) {
  const capped = Math.min(parseInt(limit, 10) || 10, 25);
  if (provider === 'itunes') return fetchItunes(query, capped);
  return fetchDeezer(query, capped);
}

/**
 * Resuelve el preview FRESCO de un track. Los previews de Deezer expiran
 * (param `hdnea=exp=` ≈ 15 min), así que al reproducir una canción guardada
 * se consulta de nuevo para obtener una URL válida.
 * @param {string} trackId - ID del track en el proveedor
 * @param {'deezer'|'itunes'} provider - Proveedor (solo Deezer necesita refresh)
 * @returns {Promise<string|null>} - URL de preview fresca o null
 */
export async function resolveTrackPreview(trackId, provider = 'deezer') {
  if (provider !== 'deezer' || !trackId) return null;
  const url = `https://api.deezer.com/track/${encodeURIComponent(trackId)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Deezer track failed (${res.status})`);
  const data = await res.json();
  return data?.preview || null;
}
