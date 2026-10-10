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
 *
 * Los bloques 15-16 simulan una red donde YouTube NO responde (fetch colgado) y
 * tardan ~15 s en total; el resto es instantáneo.
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
  urlMayBeExpired,
  pickMuxedFormat,
  markStreamFallback,
  activeStreamSource,
  isResolveTimeout,
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

// Con tope de tamaño (el CDN sólo entrega ~1 MiB por URL) se prefiere una pista
// ENTERA de menor calidad antes que una que no se puede terminar.
const AUDIO_WITH_LOW = [
  ...AUDIO_FORMATS,
  { itag: 599, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 32000, contentLength: '811937', url: 'https://gv/599' },
];
check('con tope: elige el m4a que cabe entero (599)', pickAudioFormat(AUDIO_WITH_LOW, { maxBytes: MAX_UPSTREAM_RANGE_BYTES })?.itag === 599);
check('con tope amplio: prefiere el mejor m4a que quepa (139 sobre 599)', pickAudioFormat(AUDIO_WITH_LOW, { maxBytes: 1400000 })?.itag === 139);
check('sin m4a que quepa: cae a opus que sí quepa (249)', pickAudioFormat([AUDIO_FORMATS[2], AUDIO_FORMATS[3]], { maxBytes: 1300000 })?.itag === 249);
check('sin tope: sigue prefiriendo 140 (no degrada gratis)', pickAudioFormat(AUDIO_WITH_LOW)?.itag === 140);
check('si nada cabe: devuelve la preferida (el caller marca playable:false)', pickAudioFormat(AUDIO_FORMATS, { maxBytes: MAX_UPSTREAM_RANGE_BYTES })?.itag === 140);

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
check('pista > 1 MiB → playable:false', resolved.playable === false);
check('sin degradación cuando nada cabe', resolved.degraded === false);

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
const beforeFallback = playerCalls().length;
const viaFallback = await resolveVideoAudio('LQ4w9xiHkrY');
const fallbackChain = playerCalls().slice(beforeFallback).map((c) => JSON.parse(c.body).context.client.clientName);
check('cae al siguiente cliente (IOS)', viaFallback.client === 'IOS', viaFallback.client);
check('el fallback devuelve audio igual', viaFallback.url === 'https://gv/140');
check('probó ANDROID_VR antes que IOS', fallbackChain.slice(0, 2).join(',') === 'ANDROID_VR,IOS', fallbackChain.join(','));

// ── 6. Canción larga: se consultan los clientes hasta encontrar un formato que
//       quepa ENTERO (el itag 599 de baja calidad sólo lo expone ANDROID) ──
clearInnertubeCaches();
playerResponder = (sent) =>
  sent.context.client.clientName === 'ANDROID'
    ? { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_WITH_LOW } }
    : { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS } };
const beforeDegraded = playerCalls().length;
const degraded = await resolveVideoAudio('dQw4w9WgXcQ');
const triedClients = playerCalls().slice(beforeDegraded).map((c) => JSON.parse(c.body).context.client.clientName);
check('elige el itag 599 (cabe entero)', degraded.itag === 599, String(degraded.itag));
check('lo sirve el cliente que lo expone (ANDROID)', degraded.client === 'ANDROID', degraded.client);
check('probó los 3 clientes en orden VR→IOS→ANDROID', triedClients.join(',') === 'ANDROID_VR,IOS,ANDROID', triedClients.join(','));
check('marca playable:true', degraded.playable === true);
check('marca degraded:true', degraded.degraded === true);
check('contentLength del formato elegido', degraded.contentLength === 811937, String(degraded.contentLength));

// Si NINGÚN cliente ofrece un formato que quepa → playable:false (preview en la card)
clearInnertubeCaches();
playerResponder = () => ({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS } });
const noFit = await resolveVideoAudio('dQw4w9WgXcQ');
check('sin formato que quepa → playable:false', noFit.playable === false);
check('y devuelve el mejor disponible (140)', noFit.itag === 140, String(noFit.itag));

// ── 7. Todos los clientes bloqueados → error explicativo ──
clearInnertubeCaches();
playerResponder = () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } });
let thrown = null;
try {
  await resolveVideoAudio('dQw4w9WgXcQ');
} catch (err) {
  thrown = err.message;
}
check('error si todos los clientes fallan', !!thrown && /ANDROID_VR/.test(thrown) && /IOS/.test(thrown), thrown);

// ── 8. Búsqueda sin coincidencia razonable → error (no reproducir algo random) ──
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

// ── 9. El search NO usa innertube/search (evita el envenenamiento) ──
check('ninguna llamada a innertube/search', !calls.some((c) => c.target.includes('/youtubei/v1/search')));

// ── 10. Rango acotado hacia googlevideo (el navegador manda `bytes=0-`: con ese
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

// ── 11. 403 en el primer bloque: ¿caducó la URL o es el allowance del CDN? ──
// (Re-resolver una URL recién resuelta sólo gasta una llamada al player.)
{
  const AT = 1_700_000_000_000;
  check('URL recién resuelta → no se re-resuelve', urlMayBeExpired({ resolvedAt: AT }, AT + 60_000) === false);
  check('URL con horas → sí se re-resuelve', urlMayBeExpired({ resolvedAt: AT }, AT + 6 * 60 * 60 * 1000) === true);
  check('sin marca de tiempo → conservador (sí re-resuelve)', urlMayBeExpired({}) === true);
  check('la resolución guarda su marca de tiempo', typeof resolved.resolvedAt === 'number' && resolved.resolvedAt > 0);
}

// ── 12. MUXED: la vía para servir una canción larga ENTERA ──
// Sus URLs sirven cualquier offset (verificado contra el CDN real), así que es
// la red de seguridad del audio-only.
{
  const MUXED = [
    { itag: 22, mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"', bitrate: 1200000, contentLength: '30000000', url: 'https://gv/22' },
    { itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', bitrate: 496000, contentLength: '13067708', url: 'https://gv/18' },
    { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4081000, contentLength: '99000000' }, // sin url → se descarta
  ];
  check('pickMuxedFormat prefiere itag 18 (el más ligero)', pickMuxedFormat(MUXED)?.itag === 18);
  check('pickMuxedFormat cae a 22 si no hay 18', pickMuxedFormat(MUXED.filter((f) => f.itag !== 18))?.itag === 22);
  check('pickMuxedFormat ignora los que no traen url', pickMuxedFormat([MUXED[2]]) === null);
  check('pickMuxedFormat sin muxed → null', pickMuxedFormat([AUDIO_FORMATS[1]]) === null);

  // Canción larga sin audio-only que quepa → se sirve el muxed (pista completa)
  clearInnertubeCaches();
  playerResponder = () => ({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS, formats: MUXED } });
  const viaMuxed = await resolveVideoAudio('dQw4w9WgXcQ');
  check('sin audio-only que quepa → usa el muxed (18)', viaMuxed.itag === 18, String(viaMuxed.itag));
  check('el muxed es playable (no limitado por rango)', viaMuxed.playable === true);
  check('el muxed no necesita fallback', viaMuxed.fallbackUrl === null, String(viaMuxed.fallbackUrl));
  check('contentLength del muxed', viaMuxed.contentLength === 13067708, String(viaMuxed.contentLength));

  // Canción que SÍ cabe como audio-only → se sigue prefiriendo el archivo pequeño,
  // pero con el muxed apuntado como red de seguridad
  clearInnertubeCaches();
  playerResponder = () => ({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_WITH_LOW, formats: MUXED } });
  const conFallback = await resolveTrackAudio({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 });
  check('si el audio-only cabe, se usa (599)', conFallback.itag === 599, String(conFallback.itag));
  check('y queda apuntado el muxed como fallback', conFallback.fallbackUrl === 'https://gv/18', String(conFallback.fallbackUrl));
  check('con su tamaño para recalcular offsets', conFallback.fallbackLength === 13067708);
}

// ── 13. Fuente activa y marca sticky del fallback ──
{
  check('activeStreamSource: sin fallback usa el elegido', activeStreamSource({ url: 'https://gv/599', contentLength: 811937 })?.url === 'https://gv/599');
  const switched = activeStreamSource({ url: 'https://gv/599', contentLength: 811937, useFallback: true, fallbackUrl: 'https://gv/18', fallbackLength: 13067708 });
  check('activeStreamSource: con fallback usa el muxed', switched.url === 'https://gv/18' && switched.contentLength === 13067708);
  check('activeStreamSource: useFallback sin url → el elegido', activeStreamSource({ url: 'https://gv/599', useFallback: true })?.url === 'https://gv/599');

  // La marca se guarda en la caché del proceso (sobrevive a la siguiente petición)
  const track = { artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 };
  check('markStreamFallback sobre pista con fallback → true', markStreamFallback(track) === true);
  const again2 = await resolveTrackAudio(track);
  check('la siguiente lectura de caché ya viene con useFallback', again2.useFallback === true);
  check('y su fuente activa es el muxed', activeStreamSource(again2).url === 'https://gv/18');
  check('markStreamFallback sobre una desconocida → false', markStreamFallback({ artist: 'x', title: 'y', duration: 1 }) === false);
}

// ── 14. Health info ──
const info = getInnertubeInfo();
check('health informa provider y clientes', info.provider === 'innertube' && info.clients.length === 3, JSON.stringify(info.clients));

// ── 15. Presupuesto de tiempo ──
// En serverless la resolución corre dentro del reloj de la función: sin
// presupuesto, una IP donde YouTube no responde acaba en el 504 opaco de la
// plataforma tras ~60 s (y el usuario sólo ve el preview al final). Con
// presupuesto se corta antes y el error es legible (los handlers lo mapean a 504).
{
  clearInnertubeCaches();
  // Los timers de AbortSignal.timeout están "unref" en Node: sin trabajo pendiente
  // el proceso saldría antes de que el presupuesto aborte. Este intervalo mantiene
  // vivo el bucle mientras duran las dos subpruebas.
  const keepAlive = setInterval(() => {}, 250);
  const hangingFetch = (url, options = {}) =>
    new Promise((_, reject) => {
      const signal = options.signal;
      if (!signal) return; // cuelga indefinidamente (para el test basta)
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason));
    });

  // (a) Todo cuelga (búsqueda incluida)
  globalThis.fetch = hangingFetch;
  const startedAll = Date.now();
  let errAll = null;
  try {
    await resolveTrackAudio(
      { artist: 'Nadie', title: 'Colgada Presupuesto Test', duration: 180 },
      { budgetMs: 1500 }
    );
  } catch (err) {
    errAll = err.message;
  }
  const elapsedAll = Date.now() - startedAll;
  check('presupuesto: todo colgado → error de timeout legible', /a tiempo \(timeout\)/.test(errAll || ''), errAll);
  check('presupuesto: reconocible como timeout (504 en el handler)', isResolveTimeout({ message: errAll }) === true);
  check('presupuesto: se rinde con el presupuesto, no a los 60 s', elapsedAll < 4_000, `${elapsedAll} ms`);

  // (b) La búsqueda responde y el player cuelga: la cadena de clientes se corta
  let playerTries = 0;
  globalThis.fetch = (url, options = {}) => {
    const target = String(url);
    if (target.includes('/player')) playerTries++;
    return target.includes('/results?')
      ? Promise.resolve({ ok: true, status: 200, text: async () => SEARCH_HTML })
      : hangingFetch(url, options);
  };
  const startedPlayer = Date.now();
  let errPlayer = null;
  try {
    // Presupuesto suficiente para ARRANCAR el primer cliente (el mínimo son
    // 2,5 s) y ver que el propio paso se aborta al agotarse, en vez de esperar
    // los 7 s del timeout por paso.
    await resolveTrackAudio(
      { artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 },
      { budgetMs: 4000, fresh: true }
    );
  } catch (err) {
    errPlayer = err.message;
  }
  const elapsedPlayer = Date.now() - startedPlayer;
  check('presupuesto: player colgado → mismo error de timeout', /a tiempo \(timeout\)/.test(errPlayer || ''), errPlayer);
  check('presupuesto: se intenta UN cliente y NO los 3', playerTries === 1, `${playerTries} intentos`);
  check('presupuesto: el paso se aborta al agotarse, no a los 7 s', elapsedPlayer >= 3_000 && elapsedPlayer < 6_000, `${elapsedPlayer} ms`);

  clearInterval(keepAlive);
}

// ── 16. Los HANDLERS responden su propio 504 (no el de la plataforma) ──
// En producción el fallo se veía como un 504 "de Vercel" tras ~60 s (y el usuario
// sólo recibía el preview al final). Con presupuesto, el handler contesta él mismo
// un 504 legible en segundos: mismo fallback en el cliente, pero rápido y con
// motivo. Se llaman los handlers REALES (no un mock) con un fetch colgado.
{
  const keepAlive = setInterval(() => {}, 250);
  globalThis.fetch = (url, options = {}) =>
    new Promise((_, reject) => {
      const signal = options.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason));
    });

  const { default: streamHandler } = await import('../api/music/stream.js');
  const { default: resolveHandler } = await import('../api/music/resolve.js');
  const query = 'artist=Nadie&title=Colgada%20Handlers%20Test&duration=180';

  for (const [name, handler] of [['stream', streamHandler], ['resolve', resolveHandler]]) {
    const started = Date.now();
    const res = await handler(
      new Request(`https://app.foranly.space/api/music/${name}?${query}`, {
        headers: { range: 'bytes=0-' },
      })
    );
    const body = await res.text();
    const elapsed = Date.now() - started;
    check(`${name}: 504 propio (no el opaco de la plataforma)`, res.status === 504, `status=${res.status}`);
    check(`${name}: responde en segundos, no en ~60 s`, elapsed < 15_000, `${elapsed} ms`);
    check(`${name}: explica el motivo`, /a tiempo \(timeout\)/.test(body), body.slice(0, 90));
  }

  clearInterval(keepAlive);
}

// ── 17. Pre-warm servido por el MISMO handler del stream ──
// En Vercel cada archivo de api/ es una función distinta (memoria propia), así
// que precalentar desde /api/music/resolve no compartía la caché con
// /api/music/stream. El pre-warm se pide ahora a esta misma función con
// `prewarm=1`: resuelve y cachea, y NO descarga audio.
{
  clearInnertubeCaches();
  let gvHits = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://gv/')) gvHits++;
    if (target.includes('/results?')) {
      return { ok: true, status: 200, text: async () => SEARCH_HTML };
    }
    if (target.includes('/youtubei/v1/player')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: AUDIO_FORMATS, formats: [] } }),
      };
    }
    throw new Error(`fetch inesperado en el test: ${target}`);
  };

  const { default: streamHandler } = await import('../api/music/stream.js');
  const q = 'artist=Rick%20Astley&title=Never%20Gonna%20Give%20You%20Up&duration=213';

  const warm = await streamHandler(
    new Request(`https://app.foranly.space/api/music/stream?${q}&prewarm=1`)
  );
  const warmBody = await warm.json();
  check('prewarm: responde JSON 200 (sin audio)', warm.status === 200 && /application\/json/.test(warm.headers.get('content-type') || ''), `status=${warm.status} ct=${warm.headers.get('content-type')}`);
  check('prewarm: se identifica como prewarm', warmBody.prewarm === true && warmBody.success === true);
  check('prewarm: devuelve el formato resuelto', warmBody.videoId === 'dQw4w9WgXcQ' && warmBody.itag === 140, `${warmBody.videoId}/${warmBody.itag}`);
  check('prewarm: NO descarga audio del CDN', gvHits === 0, `${gvHits} peticiones a googlevideo`);

  // Y deja la caché caliente para la petición real, en el mismo proceso
  const cachedResolve = await resolveTrackAudio({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 213 });
  check('prewarm: la resolución posterior es caché', cachedResolve.cached === true);
}

// ── 18. Marcador de build en health ──
// Un solo request debe bastar para saber qué código corre en produccion.
{
  const { default: healthHandler } = await import('../api/music/health.js');
  const res = await healthHandler(new Request('https://app.foranly.space/api/music/health'));
  const body = await res.json();
  check('health: responde con marcador de build', res.status === 200 && /^music-\d+$/.test(body.build || ''), String(body.build));
  check('health: sigue informando el resolver', body.ok === true && body.stream === 'innertube' && Array.isArray(body.clients));
}

globalThis.fetch = realFetch;
console.log(failures === 0 ? '\nTODO OK' : `\nFALLARON ${failures}`);
process.exit(failures === 0 ? 0 : 1);
