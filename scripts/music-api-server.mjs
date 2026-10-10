/**
 * music-api-server.mjs — servidor de música autónomo (host propio).
 *
 * POR QUÉ EXISTE: las funciones `api/music/*.js` de Vercel dejaron de responder
 * en producción (cualquier función nueva/modificada se cuelga, incluso trivial y
 * plana; ver README → stream en producción). En su lugar, Vercel puede REESCRIBIR
 * `/api/music/*` hacia un host propio — el mismo mecanismo que ya usa para
 * `/api/image-proxy` y `/cdn/*`, que funcionan hoy.
 *
 * Ventajas frente a la función serverless:
 *   - No hay tope de tiempo de función: un rewrite no es una función → se acabaron
 *     los 504 por reloj (el audio puede tardar lo que tarde la canción).
 *   - El host resuelve YouTube con su propia IP (la URL firmada coincide).
 *   - El código es EL MISMO: se importan los handlers de api/music/*.js a través de
 *     api/_musicHttp.js, así que producción y local no se separan.
 *
 * Uso:
 *   MUSIC_PORT=5990 node scripts/music-api-server.mjs      (o `npm run music-api`)
 *   MUSIC_HOST=127.0.0.1 MUSIC_PORT=5990 npm run music-api  (solo loopback)
 *
 * Rutas: /api/music/health, /api/music/resolve, /api/music/stream (con Range y
 * `prewarm=1`), /api/music-search. CORS `*` para poder llamarlo también desde el
 * navegador. Cualquier otra ruta → 404.
 *
 * Luego, en vercel.json (antes de las otras rewrites):
 *   { "source": "/api/music/(.*)", "destination": "http://TU-HOST:PUERTO/api/music/$1" }
 */

import http from 'node:http';
import { createMusicRequestListener } from '../api/_musicHttp.js';

const PORT = Number(process.env.MUSIC_PORT || process.env.PORT || 5990);
const HOST = process.env.MUSIC_HOST || '0.0.0.0';
const QUIET = process.env.MUSIC_QUIET === '1';

const handleMusicRequest = createMusicRequestListener({
  onRequest: QUIET ? undefined : ({ path, status, ms }) => {
    console.log(`${new Date().toISOString()} ${status} ${path} ${ms}ms`);
  },
});

const server = http.createServer((req, res) => {
  handleMusicRequest(req, res)
    .then((handled) => {
      if (handled) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    })
    .catch((err) => {
      console.error('[music-api] error inesperado:', err?.message || err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal error');
      } else {
        res.destroy();
      }
    });
});

server.keepAliveTimeout = 65_000; // el <audio> reutiliza la conexión entre bloques
server.headersTimeout = 70_000;
server.requestTimeout = 0; // el streaming de un bloque puede tardar

server.listen(PORT, HOST, () => {
  console.log(`🎵 music-api escuchando en http://${HOST}:${PORT}`);
  console.log(`   health: http://localhost:${PORT}/api/music/health`);
  console.log('   rewrite para vercel.json:');
  console.log(`     { "source": "/api/music/(.*)", "destination": "http://TU-HOST:${PORT}/api/music/$1" }`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal}: cerrando music-api…`);
    server.close(() => process.exit(0));
  });
}
