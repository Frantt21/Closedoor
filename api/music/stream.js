/**
 * Vercel serverless function — proxy de STREAMING progresivo para el music server.
 *
 * Los REWRITES de Vercel no dejan pasar streams chunked (403/timeout). Pero las
 * FUNCIONES serverless de Node.js sí soportan respuestas streaming (enviadas por
 * chunks, sin el límite de payload de 4.5MB): esto proxya /api/music/stream del
 * music server (yt-dlp + ffmpeg) en tiempo real, misma-origen y por HTTPS.
 *
 * Cómo se usa:
 *   https://app.foranly.space/api/music/stream?artist=...&title=...&duration=...
 *
 * Notas:
 *  - El tope de duración (maxDuration) aplica al reloj de TODA la descarga; si
 *    googlevideo va lento (throttling a IP de datacenter), el stream puede
 *    cortarse a los maxDuration segundos. Por eso el frontend usa por defecto
 *    el TÚNEL HTTPS automático (cloudflared, sin tope) y esta función solo si
 *    VITE_MUSIC_STREAM_VIA_VERCEL=1 o no hay túnel.
 *  - maxDuration: 60 es seguro en todos los planes Hobby (Fluid Compute permite
 *    hasta 300). Súbelo si tu plan lo admite y ves cortes.
 *  - No acumula el body en memoria: pipea el ReadableStream del upstream directo
 *    al Response (requiere Node >= 18 / fetch con body streaming).
 */

export const config = {
  runtime: 'nodejs',
  supportsResponseStreaming: true,
  maxDuration: 60,
};

const UPSTREAM_BASE = process.env.MUSIC_SERVER_URL || 'http://mapi.foranly.space:24633';

export default async function handler(req) {
  const url = new URL(req.url, 'https://app.foranly.space');
  const artist = url.searchParams.get('artist') || '';
  const title = url.searchParams.get('title') || '';
  const duration = url.searchParams.get('duration') || 0;

  if (!title) {
    return new Response(JSON.stringify({ success: false, error: 'Missing ?title parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const qs = new URLSearchParams({ artist, title });
  if (duration) qs.set('duration', String(duration));

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE}/api/music/stream?${qs.toString()}`);
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: `Music server unreachable: ${err.message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ success: false, error: `Music server responded ${upstream.status}` }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Pipea el stream del upstream directo al cliente (sin bufferizar).
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
    'Cache-Control': 'no-store',
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers['Content-Length'] = contentLength;
  return new Response(upstream.body, { status: 200, headers });
}
