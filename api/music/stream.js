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
 *   GET /api/music/stream?artist=…&title=…&prewarm=1   (resuelve SIN audio)
 *
 * ⚠️ El pre-warm vive AQUÍ y no en /api/music/resolve a propósito: en Vercel cada
 * archivo de `api/` es una función distinta (contenedor y memoria propios), así
 * que precalentar desde otra función no compartía la caché y el stream pagaba la
 * resolución completa igualmente. Pidiendo `prewarm=1` a ESTA función, la
 * resolución queda cacheada en la instancia que después sirve el audio.
 *
 * Respuestas: 200/206 audio, 200 JSON (prewarm), 400 falta título, 404 sin
 * coincidencia razonable, 504 presupuesto de resolución agotado, 502 fallo al
 * resolver o al traer el audio.
 */

import {
  resolveTrackAudio,
  upstreamRangeHeader,
  urlMayBeExpired,
  markStreamFallback,
  isResolveTimeout,
  activeStreamSource as activeSource,
} from '../_innertube.js';

// SIN `export const config` (ver api/music/health.js): era la única familia de
// funciones que lo declaraba y las tres colgaban en producción. El tope del
// reloj —cada petición sirve como máximo un bloque de 1 MiB (ver
// upstreamRangeHeader), así que no depende de la duración de la canción— vive en
// vercel.json (`functions["api/music/stream.js"].maxDuration = 60`).

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

// Cada bloque es ≤1 MiB: en 12 s o llega o esa URL no sirve. Con dos intentos
// posibles, un CDN colgado consume 24 s como máximo (y el total sigue por
// debajo del tope de la función: ver maxDuration).
const AUDIO_TIMEOUT_MS = 10_000;

// Presupuestos de resolución DENTRO de esta función. La suma del peor caso tiene
// que caber en maxDuration (60 s, verificado en producción que Vercel lo respeta:
// la función moría a los 60,4 s): primera resolución + intento de audio +
// re-resolución (URL caducada) + intento = 20 + 10 + 12 + 10 = 52 s, con ~8 s de
// margen para el arranque en frío. El default del resolver (25 s) se reserva para
// /resolve, cuyo tope son 30 s.
const RESOLVE_BUDGET_FIRST_MS = 20_000;
const RESOLVE_BUDGET_RETRY_MS = 12_000;

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
  const prewarm = url.searchParams.get('prewarm') === '1';

  if (!title && !videoId) {
    return jsonResponse({ success: false, error: 'Falta ?title o ?videoId' }, 400);
  }

  // ── Resolver (con caché en memoria del proceso) ──
  let resolved;
  try {
    resolved = await resolveTrackAudio(
      { artist, title, duration, videoId },
      { budgetMs: RESOLVE_BUDGET_FIRST_MS }
    );
  } catch (err) {
    const notFound = /coincidencia razonable/.test(err.message || '');
    // 504 propio y rápido en vez de esperar a que la plataforma corte la
    // función (que devolvía el 504 opaco tras 60 s).
    const status = notFound ? 404 : isResolveTimeout(err) ? 504 : 502;
    return jsonResponse(
      { success: false, error: err.message || 'No se pudo resolver el stream' },
      status
    );
  }

  // ── Pre-warm: resolver y cachear en ESTA instancia, sin tocar el CDN ──
  if (prewarm) {
    return jsonResponse({
      success: true,
      prewarm: true,
      videoId: resolved.videoId,
      itag: resolved.itag,
      mimeType: resolved.mimeType,
      contentLength: resolved.contentLength,
      playable: resolved.playable !== false,
      degraded: !!resolved.degraded,
      cached: !!resolved.cached,
    });
  }

  // ── Traer el audio ──
  const source = { ...activeSource(resolved) };
  let upstreamRange = upstreamRangeHeader(req.headers.get('range'), source.contentLength);
  if (upstreamRange === null) {
    return jsonResponse({ success: false, error: 'Rango fuera del archivo' }, 416);
  }
  const isFirstChunk = upstreamRange.startsWith('bytes=0-');
  const userAgent = req.headers.get('user-agent');

  let upstream;
  try {
    upstream = await fetchAudio(source.url, upstreamRange, userAgent);

    // Reintento 1: la URL pudo caducar (tiene horas) → resolver de nuevo y
    // repetir. Un 403 en el primer bloque de una URL recién resuelta NO es
    // caducidad (es el allowance del CDN por URL: ver _innertube.js).
    if ((upstream.status === 403 || upstream.status === 410) && isFirstChunk && urlMayBeExpired(resolved)) {
      resolved = await resolveTrackAudio(
        { artist, title, duration, videoId },
        { fresh: true, budgetMs: RESOLVE_BUDGET_RETRY_MS }
      );
      const retrySource = activeSource(resolved);
      upstreamRange = upstreamRangeHeader(req.headers.get('range'), retrySource.contentLength) ?? upstreamRange;
      upstream = await fetchAudio(retrySource.url, upstreamRange, userAgent);
    }

    // Reintento 2: el CDN no da más de esa URL y hay MUXED disponible → se sirve
    // desde el muxed, que no está limitado por rango. Queda marcado en la caché
    // para que los siguientes bloques y los seek lean el mismo archivo.
    if (
      (upstream.status === 403 || upstream.status === 410) &&
      isFirstChunk &&
      resolved.fallbackUrl &&
      !resolved.useFallback &&
      markStreamFallback({ artist, title, duration })
    ) {
      resolved = { ...resolved, useFallback: true };
      const fallbackSource = activeSource(resolved);
      upstreamRange = upstreamRangeHeader(req.headers.get('range'), fallbackSource.contentLength) ?? upstreamRange;
      upstream = await fetchAudio(fallbackSource.url, upstreamRange, userAgent);
    }
  } catch (err) {
    return jsonResponse(
      { success: false, error: `Audio no disponible: ${err.message}` },
      isResolveTimeout(err) ? 504 : 502
    );
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
