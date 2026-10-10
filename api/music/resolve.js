/**
 * Vercel serverless function — precalienta la resolución de un stream.
 *
 * Igual que /api/music/stream pero sin enviar audio: sirve para que al pulsar
 * play la URL ya esté resuelta y cacheada en la instancia.
 *
 * No devuelve la URL de googlevideo a propósito: está firmada para la IP del
 * server y no le sirve al navegador.
 *
 * Uso: GET /api/music/resolve?artist=...&title=...&duration=...
 */

import { resolveTrackAudio } from '../_innertube.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const url = new URL(req.url, 'https://app.foranly.space');
  const artist = url.searchParams.get('artist') || '';
  const title = (url.searchParams.get('title') || '').trim();
  const videoId = url.searchParams.get('videoId') || '';
  const duration = Number(url.searchParams.get('duration')) || 0;

  if (!title && !videoId) {
    return new Response(JSON.stringify({ success: false, error: 'Falta ?title o ?videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  try {
    const resolved = await resolveTrackAudio({ artist, title, duration, videoId });
    return new Response(
      JSON.stringify({
        success: true,
        videoId: resolved.videoId,
        itag: resolved.itag,
        mimeType: resolved.mimeType,
        contentLength: resolved.contentLength,
        cached: !!resolved.cached,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  } catch (err) {
    const notFound = /coincidencia razonable/.test(err.message || '');
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: notFound ? 404 : 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
