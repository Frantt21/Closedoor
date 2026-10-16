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

/** Modulo real del servidor, ojo: la ruta es relativa a ESTE archivo. */
const SERVER_MODULE = './scripts/music-api-server.mjs';

/**
 * Los 7 archivos que tienen que estar en el host, en estas rutas exactas.
 * Lista estatica a proposito: leer el disco aqui exigiria `fs` + `import.meta`
 * (o `__dirname`), y eso ataria este archivo a ESM o a CommonJS. Un error claro
 * con la lista es toda la ayuda que hace falta cuando falta un archivo.
 */
const REQUIRED_FILES = [
  'scripts/music-api-server.mjs',
  'api/_musicHttp.js',
  'api/_music.js',
  'api/_innertube.js',
  'api/music/_health.js',
  'api/music/_resolve.js',
  'api/music/_stream.js',
];

import(SERVER_MODULE).catch((err) => {
  // ERR_MODULE_NOT_FOUND trae la ruta que no encontro: decirla evita tener que
  // adivinar cual de los 7 falta (el stack de node la entierra entre frames).
  const missing =
    typeof err?.url === 'string' && err.url.startsWith('file:')
      ? decodeURIComponent(new URL(err.url).pathname)
      : null;

  console.error('[music-server] no se pudo arrancar el servidor de música.');
  if (missing) console.error(`[music-server] falta este archivo: ${missing}`);
  console.error(
    '[music-server] deben existir, junto a este music-server.js, estas rutas exactas:'
  );
  for (const file of REQUIRED_FILES) console.error(`  - ${file}`);
  console.error('[music-server] error original:');
  console.error(err);
  process.exit(1);
});
