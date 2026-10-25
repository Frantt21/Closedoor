/**
 * Buscador de canciones con innertube, acotado al catálogo de YouTube Music
 * (no al YouTube general) — fuente PRIMARIA del buscador.
 *
 * Antes la búsqueda iba a iTunes/Deezer, que tienen un catálogo más ordenado
 * pero pésima precisión con canciones populares (versiones, covers, tributos).
 * searchYouTubeMusic descarta las subidas de YouTube (UGC), podcasts y
 * colecciones: devuelve solo canciones/vídeos musicales del catálogo. El
 * frontend pide después un preview de 30 s a iTunes SOLO como respaldo del
 * reproductor (YouTube Music no trae preview).
 *
 * Uso: GET /api/music/ytsearch?q=daft%20punk%20get%20lucky&limit=8
 *
 * ⚠️ El nombre lleva `_` A PROPÓSITO: en Vercel cualquier archivo bajo `api/` se
 * convierte en función serverless y una función GANA al rewrite de vercel.json
 * (ver api/_musicHttp.js). Con `_`, la ruta la sirve el host propio
 * (scripts/music-api-server.mjs), el plugin de dev y `server.js`.
 */

import { searchYouTubeMusic } from '../_innertube.js';
import { normalizeYouTubeTracks } from '../_music.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url, 'https://app.foranly.space');
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return jsonResponse({ success: false, error: 'Missing ?q parameter' }, 400);

  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 10, 1), 20);

  try {
    const candidates = await searchYouTubeMusic(q, { limit });
    return jsonResponse({
      success: true,
      provider: 'youtube',
      results: normalizeYouTubeTracks(candidates),
    });
  } catch (err) {
    console.warn('[music/ytsearch]', err?.message || err);
    return jsonResponse({ success: false, error: err?.message || 'YouTube search error' }, 502);
  }
}
