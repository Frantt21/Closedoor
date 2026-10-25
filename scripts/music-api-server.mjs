/**
 * music-api-server.mjs — servidor de música autónomo (host propio o app de escritorio).
 *
 * POR QUÉ EXISTE: las funciones `api/music/*.js` de Vercel dejaron de responder
 * en producción (cualquier función nueva/modificada se cuelga, incluso trivial y
 * plana; ver README → stream en producción). En su lugar, Vercel REESCRIBE
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
 * ⚠️ DOS USOS, MISMO CÓDIGO:
 *   1. CLI (host propio / Pterodactyl):   node scripts/music-api-server.mjs
 *        MUSIC_PORT=5990 node scripts/music-api-server.mjs
 *        MUSIC_HOST=127.0.0.1 MUSIC_PORT=5990 npm run music-api   (solo loopback)
 *      (en Pterodactyl/Wings, si no hay MUSIC_PORT ni PORT se usa SERVER_PORT, el
 *      puerto que el panel ya tiene asignado: sin esto el proceso se queda en 5990
 *      y la URL publica del contenedor da connection refused)
 *   2. Módulo (app de escritorio, desktop/main.js):
 *        const { startMusicServer } = await import('.../scripts/music-api-server.mjs');
 *        const srv = await startMusicServer({ host: '127.0.0.1', port: 5990, quiet: true });
 *        srv.url;   // 'http://127.0.0.1:5990'  ← el cliente lo usa como base de /api/music
 *        await srv.close();
 *
 * Rutas: /api/music/health, /api/music/resolve, /api/music/stream (con Range y
 * `prewarm=1`), /api/music/ytsearch (búsqueda innertube), /api/music-search. CORS `*` para poder llamarlo también desde el
 * navegador (en escritorio la web vive en https://app.foranly.space y el audio
 * sale de 127.0.0.1 — origen distinto pero "potentially trustworthy", ver
 * plugins/cspPlugin.js).
 *
 * Luego, en vercel.json (antes de las otras rewrites):
 *   { "source": "/api/music/(.*)", "destination": "http://TU-HOST:PUERTO/api/music/$1" }
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMusicRequestListener } from '../api/_musicHttp.js';

/**
 * Puerto por defecto. FIJO a propósito: el cliente lo conoce de antemano (CSP y
 * CORS lo incluyen) y la app de escritorio lo publica en `window.foranlyDesktop`.
 */
export const DEFAULT_MUSIC_PORT = 5990;

/** `true` cuando el archivo se ejecuta como CLI (node scripts/music-api-server.mjs). */
const isMainModule = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

const defaultLog = ({ path, status, ms }) =>
  console.log(`${new Date().toISOString()} ${status} ${path} ${ms}ms`);

/**
 * Crea (sin escuchar) el servidor http de música.
 *
 * @param {{ quiet?: boolean, onRequest?: (info: {path: string, status: number, ms: number}) => void }} [options]
 *        `quiet: true` desactiva el log por petición (la app de escritorio no
 *        quiere ruido en la consola del usuario).
 * @returns {import('node:http').Server}
 */
export function createMusicServer({ quiet = false, onRequest } = {}) {
  const handleMusicRequest = createMusicRequestListener({
    onRequest: quiet ? undefined : onRequest || defaultLog,
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

  return server;
}

/**
 * Levanta el servidor de música y resuelve cuando ya está escuchando.
 *
 * @param {{ host?: string, port?: number, quiet?: boolean, log?: boolean,
 *           onRequest?: (info: {path: string, status: number, ms: number}) => void }} [options]
 * @returns {Promise<{ server: import('node:http').Server, host: string, port: number,
 *                     url: string, close: () => Promise<void> }>}
 *          `url` es siempre una URL usable por el cliente (0.0.0.0 → 127.0.0.1).
 */
export function startMusicServer({
  host = '127.0.0.1',
  port = DEFAULT_MUSIC_PORT,
  quiet = false,
  log = true,
  onRequest,
} = {}) {
  const server = createMusicServer({ quiet, onRequest });

  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);

    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      const clientHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      const url = `http://${clientHost}:${actualPort}`;

      if (log) {
        console.log(`🎵 music-api escuchando en http://${host}:${actualPort}`);
        console.log(`   health: ${url}/api/music/health`);
      }

      // `close()` tumba también las conexiones vivas: sin esto, un <audio>
      // reproduciendo mantiene el proceso abierto (y en Electron impide cerrar).
      const close = () =>
        new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        });

      resolve({ server, host, port: actualPort, url, close });
    });
  });
}

/**
 * Config del servidor a partir del entorno. La comparten el CLI y el panel
 * (music-server.js): una sola regla de precedencia.
 *
 * Orden: MUSIC_PORT (explicito) > PORT (convencion de PaaS) > SERVER_PORT
 * (Pterodactyl/Wings, el puerto asignado al contenedor: sin esto el proceso se
 * queda en 5990 y la URL publica del panel da connection refused) > 5990.
 */
export function resolveServerOptionsFromEnv(env = process.env) {
  const source = env.MUSIC_PORT
    ? 'MUSIC_PORT'
    : env.PORT
      ? 'PORT'
      : env.SERVER_PORT
        ? 'SERVER_PORT'
        : 'por defecto';
  return {
    port: Number(env.MUSIC_PORT || env.PORT || env.SERVER_PORT || DEFAULT_MUSIC_PORT),
    host: env.MUSIC_HOST || '0.0.0.0',
    quiet: env.MUSIC_QUIET === '1',
    source,
  };
}

/**
 * Arranca el servidor con la config del entorno y explica el rewrite a Vercel.
 * Lo usan el CLI y el panel (music-server.js) para no duplicar el arranque.
 */
export async function startMusicServerFromEnv({ env = process.env, log = true } = {}) {
  const { port, host, quiet, source } = resolveServerOptionsFromEnv(env);
  const running = await startMusicServer({ host, port, quiet, log });
  if (log) {
    console.log(`   puerto: ${source}`);
    console.log('   rewrite para vercel.json:');
    console.log(`     { "source": "/api/music/(.*)", "destination": "http://TU-HOST:${running.port}/api/music/$1" }`);
  }
  return running;
}

/** Cierra el servidor con SIGINT/SIGTERM (CLI y panel se comportan igual). */
export function installShutdownHandlers(running, { log = true } = {}) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (log) console.log(`\n${signal}: cerrando music-api…`);
      running.close().then(() => process.exit(0));
    });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Solo cuando se ejecuta directamente: importar el módulo NO arranca nada. Si
// necesitas arrancarlo desde otro archivo (p. ej. music-server.js del panel o la
// app de escritorio), llama a startMusicServer()/startMusicServerFromEnv().
if (isMainModule) {
  const running = await startMusicServerFromEnv();
  installShutdownHandlers(running);
}
