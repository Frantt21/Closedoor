/**
 * Music dev API Plugin — sirve /api/music/* y /api/music-search en `npm run dev`.
 *
 * POR QUÉ EXISTE: las rutas de música viven en las funciones de `api/` (Vercel),
 * en `server.js` (Express) y en el servidor autónomo de host propio
 * (`scripts/music-api-server.mjs`). Con solo `npm run dev` (vite, :5173) no hay
 * nada escuchando en :3000, así que el proxy de Vite devolvía **502 Bad Gateway**
 * en /api/music/* y la card caía siempre al preview de 30 s.
 *
 * Igual que plugins/livekitTokenPlugin.js, este middleware delega en la MISMA
 * lógica que producción: `api/_musicHttp.js`, que a su vez importa los handlers de
 * `api/music/*.js`. No hay copia de la lógica ni adaptador duplicado.
 *
 * Rutas servidas:
 *   GET  /api/music/health          → api/music/health.js
 *   GET  /api/music/resolve?…       → api/music/resolve.js  (pre-warm)
 *   GET  /api/music/stream?…        → api/music/stream.js   (audio, con Range)
 *   GET  /api/music-search?q=…      → api/_music.js (Deezer / iTunes server-side)
 */

import { createMusicRequestListener } from '../api/_musicHttp.js';

export default function musicDevApiPlugin() {
  const handleMusicRequest = createMusicRequestListener();

  return {
    name: 'music-dev-api',
    apply: 'serve', // solo dev: en producción lo sirven api/music/*.js o tu host

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // `false` = la ruta no es de música; que siga el resto de middlewares.
        if (!(await handleMusicRequest(req, res))) next();
      });
    },
  };
}
