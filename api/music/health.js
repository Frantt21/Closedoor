/**
 * Vercel serverless function — estado del stream de música.
 *
 * Antes informaba el estado del music server externo (yt-dlp/ffmpeg/túnel).
 * Ahora el stream sale de innertube dentro de esta misma app, así que el health
 * reporta el cliente en uso y el estado de las cachés.
 *
 * Uso: GET /api/music/health
 */

import { getInnertubeInfo } from '../_innertube.js';

// SIN `export const config`: las funciones de `api/` que responden en produccion
// (music-search, sitemap, og-*, livekit-token) no declaran config, y estas tres
// (health, stream, resolve) eran las unicas que lo hacian. Cuelgan en produccion
// incluso en rutas que no tocan la red, y Vercel documenta que para el runtime
// Node.js "no additional configuration is needed". Los topes de duracion viven
// en vercel.json (ver `functions`).

// Marcador de build de la FUNCIÓN: permite saber en un solo request qué código
// está vivo en producción. Si /api/music/health no responde (o no trae `build`),
// lo desplegado no es esta versión: en el último incidente el dominio servía un
// cliente nuevo con funciones antiguas y costó distinguirlo.
const BUILD = 'music-3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      build: BUILD,
      stream: 'innertube',
      ...getInnertubeInfo(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
    }
  );
}
