/**
 * Vercel serverless function — stream de audio de una canción.
 *
 * Reemplaza al proxy del music server (yt-dlp + ffmpeg): ahora resuelve el
 * stream con la API innertube (ver api/_innertube.js) y proxya el archivo de
 * googlevideo.
 *
 * Por qué se proxya (y no se devuelve la URL al navegador):
 *  - La URL de googlevideo está firmada para la IP que la resolvió: desde el
 *    navegador daría 403.
 *  - Está atada a una sesión/expira (~6 h), así que no se puede cachear en el
 *    cliente indefinidamente.
 * El proxy traduce el `Range` del cliente a un bloque acotado (googlevideo
 * rechaza con 403 los rangos abiertos y los que pasan de ~1 MiB: ver
 * upstreamRangeHeader) y devuelve el 206 con su `Content-Range` real, así el
 * <audio> hace streaming progresivo y puede buscar (seek) dentro de la canción.
 *
 * Uso:
 *   GET /api/music/stream?artist=Daft%20Punk&title=Get%20Lucky&duration=248
 *   GET /api/music/stream?videoId=dQw4w9WgXcQ          (atajo si ya se conoce)
 *
 * Respuestas: 200/206 audio, 400 falta título, 404 sin coincidencia razonable,
 * 502 fallo al resolver o al traer el audio.
 */

import { resolveTrackAudio, upstreamRangeHeader } from '../_innertube.js';

export const config = {
  runtime: 'nodejs',
  supportsResponseStreaming: true,
  // Tope del reloj de la función. Cada petición sirve como máximo un bloque de
  // 1 MiB (ver upstreamRangeHeader), así que el tiempo de la función no depende
  // de la duración de la canción: el <audio> pide el resto en peticiones
  // sucesivas y cada una arranca su propio reloj.
  maxDuration: 60,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

const AUDIO_TIMEOUT_MS = 20_000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * Trae el audio del CDN de YouTube con un rango ACOTADO.
 *
 * ⚠️ El `Range` del cliente nunca se reenvía tal cual: las URLs de innertube
 * llevan `rqh=1` y googlevideo responde 403 tanto a los rangos abiertos
 * (`bytes=0-`, justo lo que manda el navegador al arrancar el <audio>) como a los
 * que pasan de ~1 MiB. Ver upstreamRangeHeader en api/_innertube.js.
 */
async function fetchAudio(streamUrl, rangeHeader, userAgent) {
  const headers = { Range: rangeHeader };
  if (userAgent) headers['User-Agent'] = userAgent;

  return fetch(streamUrl, {
    headers,
    signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
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
  const artist = url.searchParams.get('artist') || '';
  const title = (url.searchParams.get('title') || '').trim();
  const videoId = url.searchParams.get('videoId') || '';
  const duration = Number(url.searchParams.get('duration')) || 0;

  if (!title && !videoId) {
    return jsonResponse({ success: false, error: 'Falta ?title o ?videoId' }, 400);
  }

  // ── Resolver (con caché en memoria del proceso) ──
  let resolved;
  try {
    resolved = await resolveTrackAudio({ artist, title, duration, videoId });
  } catch (err) {
    const notFound = /coincidencia razonable/.test(err.message || '');
    return jsonResponse(
      { success: false, error: err.message || 'No se pudo resolver el stream' },
      notFound ? 404 : 502
    );
  }

  // ── Traer el audio (y reintentar UNA vez re-resolviendo si la URL venció) ──
  const upstreamRange = upstreamRangeHeader(req.headers.get('range'), resolved.contentLength);
  if (upstreamRange === null) {
    return jsonResponse({ success: false, error: 'Rango fuera del archivo' }, 416);
  }
  const isFirstChunk = upstreamRange.startsWith('bytes=0-');
  const userAgent = req.headers.get('user-agent');

  let upstream;
  try {
    upstream = await fetchAudio(resolved.url, upstreamRange, userAgent);
    if ((upstream.status === 403 || upstream.status === 410) && isFirstChunk) {
      // Sólo en el primer bloque un 403 significa "URL vencida" → resolver de
      // nuevo y reintentar. Más adelante es el tope de YouTube (no entrega más
      // audio de esta canción desde esta IP) y reintentar no ayudaría.
      resolved = await resolveTrackAudio({ artist, title, duration, videoId }, { fresh: true });
      upstream = await fetchAudio(resolved.url, upstreamRange, userAgent);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: `Audio no disponible: ${err.message}` }, 502);
  }

  if (!upstream.ok && upstream.status !== 206) {
    const blocked = upstream.status === 403 || upstream.status === 410;
    return jsonResponse(
      {
        success: false,
        error: blocked
          ? 'YouTube no entrega más audio de esta canción desde esta IP'
          : `El CDN de YouTube respondió ${upstream.status}`,
      },
      blocked ? 502 : upstream.status
    );
  }

  // ── Pasar la respuesta tal cual (206 con Range, 200 sin él) ──
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || resolved.mimeType || 'audio/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  };
  for (const header of ['content-length', 'content-range']) {
    const value = upstream.headers.get(header);
    if (value) headers[header === 'content-length' ? 'Content-Length' : 'Content-Range'] = value;
  }

  if (req.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
