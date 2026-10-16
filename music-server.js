/**
 * music-server.js — entrada del servidor de música para el panel.
 *
 * POR QUÉ ES `.js` Y NO `.mjs`: el script de arranque de este panel decide el
 * lanzador por la extension del MAIN FILE:
 *
 *   if [ "${MAIN_FILE%.js}" != "${MAIN_FILE}" ]; then node  ...; else ts-node --esm ...; fi
 *
 * O sea: con un MAIN FILE que acaba en `.js` se usa `node`; con cualquier otra
 * extension (`music-server.mjs`, `scripts/music-api-server.mjs`) cae en
 * `ts-node --esm`, que en este contenedor revienta al leer su config
 * (`TypeError: Cannot read properties of undefined (reading 'fileExists')`)
 * porque npm le instala como peer `typescript@7`, que ya no expone `ts.sys`.
 * El proyecto no tiene TypeScript ni tsconfig: ts-node no pinta nada aqui.
 *
 * Este archivo no tiene logica propia: solo carga el servidor real. El
 * `import()` es dinamico a proposito, para que funcione igual si el
 * `package.json` desplegado lleva `"type": "module"` o no.
 *
 * Uso:
 *   MAIN FILE del panel: music-server.js     (ADDITIONAL ARGUMENTS: vacio)
 *   o a mano:            node music-server.js
 *   o:                   node scripts/music-api-server.mjs  |  npm run music-server
 *
 * Configuración por entorno (sin argumentos posicionales):
 *   MUSIC_PORT (def. 5990; también acepta PORT), MUSIC_HOST (def. 0.0.0.0),
 *   MUSIC_QUIET=1 para silenciar el log de peticiones.
 */

import('./scripts/music-api-server.mjs').catch((err) => {
  console.error('[music-server] no se pudo arrancar el servidor de música:');
  console.error(err);
  process.exit(1);
});
