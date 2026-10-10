/**
 * test-innertube-resolver.mjs — Test OFFLINE del resolver de streams
 * (api/_innertube.js). Sustituye `fetch` por fixtures de respuestas REALES
 * capturadas de YouTube (forma de compactVideoRenderer con lengthText y de
 * streamingData.adaptiveFormats) para verificar el matching, la selección de
 * formato, la cadena de clientes y el manejo de errores sin depender de la red
 * (ni de la IP, que YouTube limita al hacer muchas peticiones seguidas).
 *
 * Uso: node scripts/test-innertube-resolver.mjs
 * Sale con código 1 si falla algún check.
 */
import {
  resolveTrackAudio,
  resolveVideoAudio,
  searchTracks,
  pickAudioFormat,
  pickBestCandidate,
  scoreCandidate,
  getInnertubeInfo,
  clearInnertubeCaches,
  upstreamRangeHeader,
  MAX_UPSTREAM_RANGE_BYTES,
} from '../api/_innertube.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` → ${extra}` : ''}`);
};

const realFetch = globalThis.fetch;
const calls = [];
let playerResponder = () => ({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS } });

// Formatos de audio reales (ANDROID_VR, video dQw4w9WgXcQ)
const AUDIO_FORMATS = [
  { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 49000, contentLength: '1300631', url: 'https://gv/139' },
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000, contentLength: '3449447', url: 'https://gv/140' },
  { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 49000, contentLength: '1231355', url: 'https://gv/249' },
  { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 137000, contentLength: '3433755', url: 'https://gv/251' },
  { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4081000, url: 'https://gv/137' },
];

// ytInitialData de /results (forma real: compactVideoRenderer + lengthText)
const SEARCH_DATA = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              // señuelo: mismo título pero 45 s (sped up) — debe perder por duración
              { compactVideoRenderer: { videoId: 'DECOY_spedup', title: { runs: [{ text: 'Rick Astley - Never Gonna Give You Up (Sped up)' }] }, ownerText: { runs: [{ text: 'ELTEBTS' }] }, lengthText: { runs: [{ text: '0:45' }] } } },
              { compactVideoRenderer: { videoId: 'dQw4w9WgXcQ', title: { runs: [{ text: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)' }] }, ownerText: { runs: [{ text: 'Rick Astley' }] }, lengthText: { runs: [{ text: '3:34' }] } } },
              { compactVideoRenderer: { videoId: 'LQ4w9xiHkrY', title: { runs: [{ text: 'Rick Astley - Never Gonna Give You Up [Remastered In 4K]' }] }, ownerText: { runs: [{ text: 'Enjoy it' }] }, lengthText: { runs: [{ text: '3:33' }] } } },
              // duplicado del mismo videoId en otra sección → debe deduplicarse
              { compactVideoRenderer: { videoId: 'dQw4w9WgXcQ', title: { runs: [{ text: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)' }] }, ownerText: { runs: [{ text: 'Rick Astley' }] }, lengthText: { runs: [{ text: '3:34' }] } } },
            ],
          },
        },
      ],
    },
  },
};

const SEARCH_HTML = `<!doctype html><html><body><script>var ytInitialData = ${JSON.stringify(SEARCH_DATA)};</script></body></html>`;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ target, headers: options.headers, body: options.body });
  if (target.includes('/results?')) {
    return { ok: true, status: 200, text: async () => SEARCH_HTML };
  }
  if (target.includes('/youtubei/v1/player')) {
    const sent = JSON.parse(options.body);
    const payload = playerResponder(sent);
    return { ok: true, status: 200, json: async () => payload };
  }
  throw new Error(`fetch inesperado en el test: ${target}`);
};

const playerCalls = () => calls.filter((c) => c.target.includes('/player'));
const lastPlayerClient = () => JSON.parse(playerCalls().at(-1).body).context.client.clientName;

// ── 1. Selección de formato ──
check('pickAudioFormat prefiere m4a 140', pickAudioFormat(AUDIO_FORMATS)?.itag === 140);
check('pickAudioFormat cae a opus 251 si no hay 140', pickAudioFormat(AUDIO_FORMATS.filter((f) => f.itag !== 140))?.itag === 251);
check('pickAudioFormat ignora video y elige el mejor m4a', pickAudioFormat(AUDIO_FORMATS.filter((f) => f.itag !== 140 && f.itag !== 251))?.itag === 139);
check('pickAudioFormat sin audio → null', pickAudioFormat([AUDIO_FORMATS[4]]) === null);

// ── 2. Matching por duración (el señuelo de 45 s no debe ganar) ──
{
  const best = pickBestCandidate(
    [
      { videoId: 'DECOY', title: 'Rick Astley - Never Gonna Give You Up (Sped up)', channel: 'ELTEBTS', durationSec: 45 },
      { videoId: 'GOOD', title: 'Rick Astley - Never Gonna Give You Up (Official Video)', channel: 'Rick Astley', durationSec: 214 },
    ],
    { artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 }
  );
  check('el señuelo de 45 s pierde', best?.videoId === 'GOOD', best?.videoId);
  check('score del señuelo < 0.45', scoreCandidate({ title: 'Rick Astley - Never Gonna Give You Up (Sped up)', channel: 'ELTEBTS', durationSec: 45 }, { artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 }) < 0.45);
}

// ── 3. Flujo completo: search (HTML) → match → player → URL ──
clearInnertubeCaches();
const resolved = await resolveTrackAudio({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 });
check('resuelve el videoId correcto', resolved.videoId === 'dQw4w9WgXcQ', resolved.videoId);
check('devuelve la URL del itag 140', resolved.url === 'https://gv/140', resolved.url);
check('mimeType normalizado', resolved.mimeType === 'audio/mp4', resolved.mimeType);
check('contentLength numérico', resolved.contentLength === 3449447, String(resolved.contentLength));
check('cliente usado: ANDROID_VR', resolved.client === 'ANDROID_VR', resolved.client);
check('el search se deduplicó (3 videos, no 4)', (await searchTracks('x', { limit: 10 })).length === 3);

// ── 4. Caché: la segunda resolución no vuelve a llamar ──
const callsAfterFirst = calls.length;
const again = await resolveTrackAudio({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 });
check('segunda resolución servida de caché', calls.length === callsAfterFirst && again.cached === true);
// La query nueva (fresh) sí vuelve a golpear la red
await resolveTrackAudio({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 }, { fresh: true });
check('con fresh:true vuelve a resolver', calls.length > callsAfterFirst);

// ── 5. Cadena de clientes: si VR pide verificación, cae a IOS ──
clearInnertubeCaches();
playerResponder = (sent) =>
  sent.context.client.clientName === 'ANDROID_VR'
    ? { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } }
    : { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS } };
const viaFallback = await resolveVideoAudio('LQ4w9xiHkrY');
check('cae al siguiente cliente (IOS)', viaFallback.client === 'IOS', viaFallback.client);
check('el fallback devuelve audio igual', viaFallback.url === 'https://gv/140');
check('probó ANDROID_VR antes que IOS', playerCalls().at(-2) && JSON.parse(playerCalls().at(-2).body).context.client.clientName === 'ANDROID_VR');

// ── 6. Todos los clientes bloqueados → error explicativo ──
clearInnertubeCaches();
playerResponder = () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } });
let thrown = null;
try {
  await resolveVideoAudio('dQw4w9WgXcQ');
} catch (err) {
  thrown = err.message;
}
check('error si todos los clientes fallan', !!thrown && /ANDROID_VR/.test(thrown) && /IOS/.test(thrown), thrown);

// ── 7. Búsqueda sin coincidencia razonable → error (no reproducir algo random) ──
clearInnertubeCaches();
const noMatch = await (async () => {
  try {
    await resolveTrackAudio({ artist: 'Artista Inexistente XYZ', title: 'Cancion Que No Existe 12345', duration: 200 });
    return null;
  } catch (err) {
    return err.message;
  }
})();
check('sin coincidencia → error claro', /coincidencia razonable/.test(noMatch || ''), noMatch);

// ── 8. El search NO usa innertube/search (evita el envenenamiento) ──
check('ninguna llamada a innertube/search', !calls.some((c) => c.target.includes('/youtubei/v1/search')));

// ── 9. Rango acotado hacia googlevideo (el navegador manda `bytes=0-`: con ese
//       rango abierto el CDN responde 403, así que nunca se reenvía tal cual) ──
{
  const CHUNK = MAX_UPSTREAM_RANGE_BYTES;
  const TOTAL = 3_458_673;

  check('sin Range → primer bloque', upstreamRangeHeader(null, TOTAL) === `bytes=0-${CHUNK - 1}`);
  check('Range abierto del navegador (bytes=0-) → bloque acotado', upstreamRangeHeader('bytes=0-', TOTAL) === `bytes=0-${CHUNK - 1}`);
  check('Range abierto en medio (bytes=1000000-) → acotado', upstreamRangeHeader('bytes=1000000-', TOTAL) === `bytes=1000000-${1000000 + CHUNK - 1}`);
  check('rango pequeño se respeta tal cual', upstreamRangeHeader('bytes=0-4095', TOTAL) === 'bytes=0-4095');
  check('rango mayor que el bloque se recorta', upstreamRangeHeader('bytes=0-9999999', TOTAL) === `bytes=0-${CHUNK - 1}`);
  check('el final nunca pasa del archivo (último bloque)', upstreamRangeHeader(`bytes=${TOTAL - 100}-`, TOTAL) === `bytes=${TOTAL - 100}-${TOTAL - 1}`);
  check('inicio más allá del archivo → 416 (null)', upstreamRangeHeader(`bytes=${TOTAL}-`, TOTAL) === null);
  check('Range basura → primer bloque', upstreamRangeHeader('bytes=abc', TOTAL) === `bytes=0-${CHUNK - 1}`);
  check('multipart no se reenvía', upstreamRangeHeader('bytes=0-99,200-299', TOTAL) === `bytes=0-${CHUNK - 1}`);
  check('sin contentLength no se recorta al archivo', upstreamRangeHeader('bytes=0-4095', 0) === 'bytes=0-4095');
}

// ── 10. Health info ──
const info = getInnertubeInfo();
check('health informa provider y clientes', info.provider === 'innertube' && info.clients.length === 2, JSON.stringify(info.clients));

globalThis.fetch = realFetch;
console.log(failures === 0 ? '\nTODO OK' : `\nFALLARON ${failures}`);
process.exit(failures === 0 ? 0 : 1);
