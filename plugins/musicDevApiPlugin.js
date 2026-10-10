/**
 * Music dev API Plugin — sirve /api/music/* y /api/music-search en `npm run dev`.
 *
 * POR QUÉ EXISTE: las rutas de música viven en server.js (Express) y en las
 * funciones serverless de api/ (Vercel). Con solo `npm run dev` (vite, :5173) no
 * hay nada escuchando en :3000, así que el proxy de Vite devolvía **502 Bad
 * Gateway** en /api/music/* y la card caía siempre al preview de 30 s.
 *
 * Igual que plugins/livekitTokenPlugin.js, este middleware delega en la MISMA
 * lógica que usa producción (api/music/*.js y api/_music.js) para que dev y
 * producción no se separen. Los handlers de api/music/*.js son Web-standard
 * ((req) => Response), así que aquí se adaptan a los (req, res) de Connect.
 *
 * Rutas servidas:
 *   GET  /api/music/health          → api/music/health.js
 *   GET  /api/music/resolve?…       → api/music/resolve.js  (pre-warm)
 *   GET  /api/music/stream?…        → api/music/stream.js   (audio, con Range)
 *   GET  /api/music-search?q=…      → api/_music.js (Deezer / iTunes server-side)
 *
 * ⚠️ Si se cambian los handlers de producción, este plugin los sigue
 * automáticamente (los importa); no hay copia de la lógica.
 */

import { Readable } from 'node:stream';
import healthHandler from '../api/music/health.js';
import resolveHandler from '../api/music/resolve.js';
import streamHandler from '../api/music/stream.js';
import { searchMusicServer, resolveTrackPreview } from '../api/_music.js';

// Rutas con handler Web-standard ((req) => Response).
const WEB_HANDLERS = new Map([
  ['/api/music/health', healthHandler],
  ['/api/music/resolve', resolveHandler],
  ['/api/music/stream', streamHandler],
]);

// Alias de búsqueda de metadatos (server.js expone las dos).
const SEARCH_PATHS = new Set(['/api/music-search', '/api/music/search']);

// Cabeceras que no deben reenviarse tal cual al cliente de dev.
const HOP_BY_HOP = new Set(['content-encoding', 'transfer-encoding', 'connection', 'keep-alive']);

function absoluteUrl(req) {
  const host = req.headers.host || 'localhost:5173';
  return new URL(req.url || '/', `http://${host}`).toString();
}

/** IncomingMessage → Request (solo GET/HEAD/OPTIONS: sin body que copiar). */
function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(absoluteUrl(req), { method: req.method, headers });
}

/** Response → ServerResponse, pipeando el cuerpo (importante para el audio). */
function sendWebResponse(req, res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
  });

  if (req.method === 'HEAD' || !response.body) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(response.body);
  // Si el cliente corta (p. ej. el <audio> cambia de src), liberar el upstream.
  res.on('close', () => body.destroy());
  body.on('error', () => res.destroy());
  body.pipe(res);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Misma respuesta que api/music-search.js y la ruta de server.js. */
async function handleMusicSearch(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  const url = new URL(absoluteUrl(req));
  const provider = url.searchParams.get('provider') === 'itunes' ? 'itunes' : 'deezer';

  // Modo track: preview FRESCO de Deezer (los previews expiran ≈ 15 min).
  const trackId = url.searchParams.get('track');
  if (trackId) {
    try {
      const previewUrl = await resolveTrackPreview(trackId, provider);
      sendJson(res, 200, { success: true, provider, previewUrl });
    } catch (err) {
      console.warn('[music-dev-api] preview resolve:', err?.message || err);
      sendJson(res, 502, { success: false, error: err?.message || 'Deezer error' });
    }
    return;
  }

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    sendJson(res, 400, { success: false, error: 'Missing ?q parameter' });
    return;
  }

  try {
    const results = await searchMusicServer(q, provider, url.searchParams.get('limit'));
    sendJson(res, 200, { success: true, provider, results });
  } catch (err) {
    console.warn('[music-dev-api] search:', err?.message || err);
    sendJson(res, 502, { success: false, error: err?.message || 'Music search error' });
  }
}

export default function musicDevApiPlugin() {
  return {
    name: 'music-dev-api',
    apply: 'serve', // solo dev: en producción lo sirven api/*.js y server.js

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const handler = WEB_HANDLERS.get(path);
        const isSearch = SEARCH_PATHS.has(path);
        if (!handler && !isSearch) {
          next();
          return;
        }

        try {
          if (isSearch) {
            await handleMusicSearch(req, res);
            return;
          }
          sendWebResponse(req, res, await handler(toWebRequest(req)));
        } catch (err) {
          console.warn('[music-dev-api]', path, err?.message || err);
          if (!res.headersSent) {
            sendJson(res, 502, { success: false, error: err?.message || 'Dev music API error' });
          } else {
            res.destroy();
          }
        }
      });
    },
  };
}
