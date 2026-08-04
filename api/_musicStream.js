/**
 * api/_musicStream.js — Streaming de canciones completas (yt-dlp + ffmpeg).
 *
 * Arquitectura combinada:
 *   - Metadatos:  Deezer (título, artista, álbum, portada, DURACIÓN).
 *   - Stream:     YouTube vía yt-dlp — se busca `ytsearch:"artista - título"`,
 *                 se elige el mejor candidato por similitud de título + duración
 *                 y se resuelve la URL de audio directa (m4a preferido).
 *   - Servido:    las URLs directas de googlevideo expiran y están ligadas a la
 *                 IP del server → se PROXIAN con soporte de Range. Si el formato
 *                 no es reproducible en todos los navegadores (webm/opus), se
 *                 transcodifica a m4a en streaming con ffmpeg.
 *
 * ⚠️ Requiere yt-dlp + ffmpeg instalados en el server (NO corre en Vercel
 *    serverless). Variables de entorno opcionales: YTDLP_BIN, FFMPEG_BIN.
 * ⚠️ Legal/ToS: el uso de yt-dlp con YouTube va contra sus términos de
 *    servicio; úsalo bajo tu propio criterio en tu infraestructura.
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { searchMusicServer } from './_music.js';

// yt-dlp: se respeta YTDLP_BIN, si no se auto-detecta el binario standalone
// común de `~/.local/bin/yt-dlp` (instalación típica local sin sudo) y como
// último recurso se busca en el PATH.
const localYtDlp = join(homedir(), '.local', 'bin', 'yt-dlp');
const YTDLP_BIN = process.env.YTDLP_BIN || (existsSync(localYtDlp) ? localYtDlp : 'yt-dlp');
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Cookies de cuenta logueada (ANTI-THROTTLE) ──
// En 2025-2026 YouTube throttla (~30-60 KB/s) las URLs generadas SIN sesión
// válida (validación de n-sig/po_token). Pasarle a yt-dlp un cookies.txt de
// una cuenta real (formato Netscape, exportado con "Get cookies.txt LOCALLY")
// hace que YouTube genere URLs SIN throttle → descarga a velocidad completa.
// Configurable con YTDLP_COOKIES_FILE; por defecto busca en las rutas típicas.
const localCookies = join(homedir(), '.config', 'yt-dlp', 'cookies.txt');
const YTDLP_COOKIES_FILE = (() => {
  const fromEnv = process.env.YTDLP_COOKIES_FILE || '';
  // Si el env var apunta a un archivo inexistente (typo/ruta de Android cambiada),
  // NO pasar --cookies (rompería TODAS las resoluciones) y avisar claramente.
  if (fromEnv && !existsSync(fromEnv)) {
    console.warn(`[music-stream] ⚠️ YTDLP_COOKIES_FILE no existe: ${fromEnv} → sin cookies (puede haber throttle)`);
    return existsSync(localCookies) ? localCookies : '';
  }
  return fromEnv || (existsSync(localCookies) ? localCookies : '');
})();

// ⚠️ Aceleración de extracción + ANTI-THROTTLE:
//  - El default de yt-dlp sondea VARIOS player clients (web, android, ios, tv,
//    mweb...) → lento y con más riesgo de bloqueos anti-bot.
//  - En 2025-2026 YouTube throttla fuerte los clientes móviles (android/ios) a
//    ~30-60 KB/s (el famoso "30 KB/s" que veías). `ratebypass=yes` ya NO basta:
//    YouTube movió el límite a validación de firma/tokens (n-sig, po_token).
//  - Los clients embebidos (`web_embedded`) suelen eludir el bloqueo/throttle
//    SIN necesidad de po_token. `mweb` es el recomendado oficial si se usa con
//    po_token (complejo de generar → no lo usamos por defecto).
// Si el usuario configura varios clientes con YTDLP_EXTRACTOR_ARGS, se prueban
// EN ORDEN como fallback. Por defecto, con cookies de una cuenta logueada el
// client `web` es el emparejamiento natural (las cookies vienen de una sesión
// web) y suele dar velocidad completa sin po_token → se intenta PRIMERO.
// Sin cookies, `web_embedded` elude mejor el bloqueo/throttle.
const YTDLP_CLIENTS = (() => {
  if (process.env.YTDLP_EXTRACTOR_ARGS) {
    return process.env.YTDLP_EXTRACTOR_ARGS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // Cadena de clients probados EN ORDEN hasta que uno resuelva. El client `web`
  // exige po_token en 2026 incluso con cookies ("Requested format is not
  // available") → NO va primero. Los fiables sin po_token: web_embedded, mweb,
  // tv_embedded, android (verificado con tests reales). Con cookies se añade
  // `web` al final de la cadena por si la sesión logueada sí lo permite.
  const base = [
    'youtube:player_client=web_embedded',
    'youtube:player_client=mweb',
    'youtube:player_client=tv_embedded',
    'youtube:player_client=android',
    ...(YTDLP_COOKIES_FILE ? ['youtube:player_client=web'] : []),
  ];
  return base;
})();

// ── Ejecutar yt-dlp (con timeout y límite de buffer) ──
function runYtDlp(args, { timeoutMs = 30000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    // ⚠️ NOTA: `--no-call-home` fue ELIMINADO de yt-dlp (2026): en versiones
    // nuevas da error "deprecated option". El call-home ya no existe, así que
    // simplemente no se pasa.
    const baseArgs = ['--no-warnings', '--js-runtimes', 'node'];
    if (YTDLP_COOKIES_FILE) baseArgs.push('--cookies', YTDLP_COOKIES_FILE);
    try {
      child = spawn(YTDLP_BIN, [...baseArgs, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('yt-dlp timeout'));
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBuffer) {
        finish(reject, new Error('yt-dlp output too large'));
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, new Error(`yt-dlp exit ${code}: ${stderr.split('\n').filter(Boolean).slice(0, 2).join(' | ')}`));
    });
  });
}

// ── Candidatos de YouTube (búsqueda plana, ligera) ──
export async function searchYoutubeCandidates(query, limit = 5) {
  const capped = Math.max(1, Math.min(parseInt(limit, 10) || 5, 10));
  const { stdout } = await runYtDlp(['--flat-playlist', '-J', `ytsearch${capped}:${query}`]);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('yt-dlp search returned invalid JSON');
  }
  return (data.entries || [])
    .map((e) => ({
      id: e?.id || null,
      title: e?.title || '',
      duration: Number(e?.duration) || null,
      url: e?.url || (e?.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
    }))
    .filter((e) => e.url && e.title);
}

// ── Matching: elegir el candidato que mejor coincide con el track de Deezer ──
function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function pickBestCandidate(candidates, { title, artist, duration }) {
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(artist);
  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    const cNorm = normalizeText(c.title);
    const cTokens = cNorm.split(' ').filter(Boolean);
    const titleTokens = new Set(titleNorm.split(' ').filter(Boolean));
    let score = 0;

    // Similitud por tokens con el título
    if (cTokens.length && titleTokens.size) {
      const hits = cTokens.filter((tok) => titleTokens.has(tok)).length;
      score += (hits / Math.max(cTokens.length, 1)) * 5;
    }
    // El título del candidato contiene el artista (p. ej. "Queen – Bohemian...")
    if (artistNorm && cNorm.includes(artistNorm)) score += 2;
    // Proximidad de duración (el audio oficial suele diferir pocos segundos)
    if (duration && c.duration) {
      const diff = Math.abs(duration - c.duration);
      if (diff <= 5) score += 4;
      else if (diff <= 15) score += 2;
      else if (diff <= 60) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best || candidates[0] || null;
}

// ── Resolver URL de audio directa de un video ──
// Prueba los clients configurados EN ORDEN (web_embedded → mweb → tv_embedded
// → android → [web si hay cookies]) y cae al comportamiento por defecto como
// último recurso. Se loguea qué client resolvió para diagnosticar en la
// terminal del server.
// Selector de formato PERMISIVO pero de AUDIO PURO:
//   ba[ext=m4a] → mejor audio m4a (itag 140, sin transcode, proxy directo)
//   ba          → mejor audio puro (webm/opus itag 251 → transcode a m4a)
//   b           → último recurso: cualquier formato (video+audio → transcode)
// Se OMITE `ba[ext=mp4]` a propósito: matchea videos mp4 con audio (itag 18/22,
// mime video/mp4) y fuerza transcode innecesario. Un selector estricto como el
// viejo (`bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio`) aborta con
// "Requested format is not available" cuando el client exige po_token.
export async function resolveBestAudioUrl(videoUrl) {
  const run = (extra) => runYtDlp([
    '-f', 'ba[ext=m4a]/ba/b',
    '--get-url',
    '--no-playlist',
    ...extra,
    videoUrl,
  ]);
  const parseUrl = (stdout) => stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//.test(l));
  // 1) Clients configurados en orden
  for (const client of YTDLP_CLIENTS) {
    try {
      const { stdout } = await run(['--extractor-args', client]);
      const line = parseUrl(stdout);
      if (line) {
        console.info(`[music-stream] resuelto con client: ${client.replace('youtube:player_client=', '')}`);
        return line;
      }
    } catch { /* probar el siguiente client */ }
  }
  // 2) Último recurso: comportamiento por defecto de yt-dlp (multi-client)
  const { stdout } = await run([]);
  const line = parseUrl(stdout);
  if (!line) throw new Error('No audio URL resolved');
  return line;
}

// ── Cache de URLs resueltas (memoria + disco) ──
// - Las URLs directas de googlevideo expiran ≈ 6h y están ligadas a la IP del
//   server → TTL seguro de 4h, tanto en memoria como en disco.
// - Las entradas expiradas se ELIMINAN al accederlas (el Map no crece sin límite).
// - `inflight` deduplica resoluciones concurrentes de la misma canción.
// - El caché se PERSISTE a disco (junto al server) para no re-resolver tras un
//   reinicio. En entornos de FS de solo lectura (Vercel) las escrituras fallan
//   en silencio y se sigue con el caché en memoria.
const STREAM_CACHE_TTL = 4 * 60 * 60 * 1000; // 4h
// Versión de la estrategia de resolución: si cambia la config de clients O el
// estado de las cookies (añadir/quitar cookies.txt), las URLs cacheadas se
// invalidan automáticamente aunque no hayan expirado — crítico porque las URLs
// resueltas SIN cookies vienen throttled por YouTube.
const CACHE_VERSION = `v3-cookies-${YTDLP_COOKIES_FILE ? 'yes' : 'no'}`;
const streamCache = new Map();
const inflightStream = new Map();

const DISK_CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.music-stream-cache.json');

function loadDiskCache() {
  try {
    if (!existsSync(DISK_CACHE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(DISK_CACHE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    // Versión distinta (o AUSENTE → caché vieja) → descartar todo el caché
    // (la estrategia de clientes/cookies cambió y las URLs viejas vienen
    // throttled por YouTube). Se reescribe el archivo con la versión nueva.
    if (parsed.__version !== CACHE_VERSION) {
      try { writeFileSync(DISK_CACHE_FILE, JSON.stringify({ __version: CACHE_VERSION }), 'utf8'); } catch { /* ignorar */ }
      return null;
    }
    return parsed;
  } catch {
    return null; // archivo corrupto o inexistente → caché en memoria nomás
  }
}

// Guarda en disco solo las entradas vigentes y poda el mapa en memoria.
function persistCache() {
  try {
    const now = Date.now();
    const entries = { __version: CACHE_VERSION };
    let n = 0;
    for (const [k, v] of streamCache) {
      if (!v?.url || now - v.at >= STREAM_CACHE_TTL) {
        streamCache.delete(k); // expirada/corrupta → liberar memoria también
        continue;
      }
      if (n < 50) {
        entries[k] = v;
        n += 1;
      }
    }
    writeFileSync(DISK_CACHE_FILE, JSON.stringify(entries), 'utf8');
  } catch {
    /* FS de solo lectura (Vercel) o sin permisos → se ignora */
  }
}

// Sembrar el caché en memoria desde disco al arrancar (solo entradas vigentes).
(function seedCache() {
  const disk = loadDiskCache();
  if (!disk) return;
  const now = Date.now();
  for (const [k, v] of Object.entries(disk)) {
    if (k === '__version') continue;
    if (v?.url && now - v.at < STREAM_CACHE_TTL) streamCache.set(k, v);
  }
})();

export async function resolveStream({ artist = '', title, duration }, { fresh = false } = {}) {
  if (!title) throw new Error('Missing title');
  const query = [String(artist || '').trim(), String(title).trim()].filter(Boolean).join(' - ') || String(title);
  const key = query.toLowerCase();
  const hit = streamCache.get(key);
  // El hit debe ser de la MISMA versión de clientes (si no, se re-resuelve)
  if (!fresh && hit && hit.__v === CACHE_VERSION && Date.now() - hit.at < STREAM_CACHE_TTL) {
    return { url: hit.url, mime: hit.mime, videoTitle: hit.videoTitle, videoId: hit.videoId };
  }
  streamCache.delete(key); // entrada (si existe) expirada o de otra versión → liberar
  if (!fresh && inflightStream.has(key)) return inflightStream.get(key);

  const p = (async () => {
    const candidates = await searchYoutubeCandidates(query, 5);
    const best = pickBestCandidate(candidates, { artist: String(artist || ''), title: String(title), duration: Number(duration) || 0 });
    if (!best) throw new Error('No YouTube candidate found');
    if (YTDLP_COOKIES_FILE) {
      console.info(`[music-stream] usando cookies de: ${YTDLP_COOKIES_FILE}`);
    }
    const url = await resolveBestAudioUrl(best.url);
    const mime = getMimeFromUrl(url);
    streamCache.set(key, { url, mime, at: Date.now(), __v: CACHE_VERSION, videoTitle: best.title, videoId: best.id });
    persistCache(); // guardar en disco (falla en silencio si no se puede)
    return { url, mime, videoTitle: best.title, videoId: best.id };
  })();
  inflightStream.set(key, p);
  try {
    return await p;
  } finally {
    if (inflightStream.get(key) === p) inflightStream.delete(key);
  }
}

// ── Detección de mime ──
function getMimeFromUrl(url) {
  try {
    const u = new URL(url);
    const mime = u.searchParams.get('mime');
    if (mime) return decodeURIComponent(mime);
  } catch { /* sigue con extensión */ }
  const extMatch = url.match(/\.(m4a|mp4|webm|ogg|opus|aac)(?:[?#]|$)/i);
  if (extMatch) {
    const map = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac' };
    return map[extMatch[1].toLowerCase()] || null;
  }
  return null;
}

function isBrowserPlayableMime(mime) {
  if (!mime) return true; // intentar directo
  const m = String(mime).toLowerCase();
  return m.startsWith('audio/mp4') || m === 'audio/aac' || m === 'audio/x-m4a' || m === 'audio/m4a';
}

// ── Logs de progreso del stream ──
// Muestran en la terminal del server cuánto se ha transferido/transcodificado
// (MB y % si el tamaño total es conocido), la VELOCIDAD real y el tiempo
// transcurrido. Se loguea como máximo cada 5s y por cada salto del 10% para
// no inundar la consola.
function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec) {
  if (!isFinite(bytesPerSec) || bytesPerSec < 0) return '';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function progressLogger({ label, total, startedAt }) {
  let sent = 0;
  let lastLogAt = 0;
  let lastPct = 0;
  let done = false;
  let lastSent = null;
  let lastTime = null;
  const emit = (mark) => {
    if (done) return; // solo un estado terminal por stream
    done = true;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(`[music-stream] ${label} → ${mark} · ${formatMB(sent)}${total ? ` / ${formatMB(total)}` : ''} · ${elapsed}s`);
  };
  return {
    add(bytes) {
      if (done) return;
      sent += bytes;
      const now = Date.now();
      const pct = total ? Math.floor((sent / total) * 100) : null;
      const shouldLog = now - lastLogAt >= 5000 || (pct !== null && pct >= lastPct + 10 && pct > 0);
      if (!shouldLog) return;
      // Velocidad media entre este log y el anterior (bytes/tiempo). El primer
      // log no tiene referencia previa → se omite la velocidad (evita un valor
      // espurio gigante por dividir entre ~0s).
      let speedStr = '';
      if (lastTime !== null) {
        const dt = (now - lastTime) / 1000;
        const speed = dt > 0 ? (sent - lastSent) / dt : 0;
        speedStr = ` · ${formatSpeed(speed)}`;
      }
      lastSent = sent;
      lastTime = now;
      lastLogAt = now;
      if (pct !== null) lastPct = pct;
      console.info(
        `[music-stream] ${label} · ${formatMB(sent)}${total ? ` / ${formatMB(total)} (${pct}%)` : ''} · ${((now - startedAt) / 1000).toFixed(1)}s${speedStr}`
      );
    },
    finish: () => emit('COMPLETO'),
    abort: () => emit('ABORTADO'),
  };
}

// ── Proxy del stream con soporte de Range ──
// ⚠️ Antithrottle: YouTube limita los streams de googlevideo a ~30-60 KB/s
// cuando la URL no lleva el parámetro `ratebypass` bien resuelto (o el client
// no es reconocido como navegador). Forzar `ratebypass=yes` levanta ese límite
// en m4a/mp4. Si la URL ya lo trae, se deja como está.
export function withRateBypass(url) {
  try {
    const u = new URL(url);
    if (/googlevideo/i.test(u.hostname)) {
      u.searchParams.set('ratebypass', 'yes');
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function proxyStream(req, res, url, label = 'proxy') {
  const target = withRateBypass(url);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ success: false, error: 'Invalid stream URL' });
    return;
  }
  const lib = parsed.protocol === 'https:' ? https : http;
  const headers = { 'User-Agent': UA };
  if (req.headers.range) headers.Range = req.headers.range;

  const proxyReq = lib.request(parsed, { method: 'GET', headers }, (upRes) => {
    res.status(upRes.statusCode || 200);
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'].forEach((h) => {
      const v = upRes.headers[h];
      if (v !== undefined) res.setHeader(h, v);
    });
    // Progreso: total = content-length, o el total de un content-range parcial
    // (bytes 0-1023/123456). Si no hay total, se loguea solo MB.
    const contentLength = Number(upRes.headers['content-length']);
    const crMatch = String(upRes.headers['content-range'] || '').match(/\/(\d+)$/);
    const total = crMatch ? Number(crMatch[1]) : (Number.isFinite(contentLength) ? contentLength : null);
    const progress = progressLogger({ label, total, startedAt: Date.now() });
    upRes.on('data', (chunk) => progress.add(chunk.length));
    upRes.on('end', () => progress.finish());
    upRes.on('error', () => progress.abort());
    upRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.warn('[music-stream] proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: 'Stream proxy error' });
    else res.end();
  });
  proxyReq.setTimeout(30000, () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ success: false, error: 'Stream proxy timeout' });
  });
  // Liberar la conexión upstream si el cliente se desconecta
  req.on('close', () => proxyReq.destroy());
  proxyReq.end();
}

// ── Transcode streaming a m4a (para webm/opus que Safari no reproduce) ──
export function transcodeStream(req, res, url, label = 'transcode') {
  let child;
  try {
    child = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-user_agent', UA,
      '-i', url,
      '-vn',
      '-acodec', 'aac', '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    res.status(500).json({ success: false, error: 'ffmpeg unavailable' });
    return;
  }
  res.setHeader('Content-Type', 'audio/mp4');
  // Sin Accept-Ranges: el transcode NO soporta seek (Safari pediría Range y
  // recibiría 200, confundiendo al reproductor). Solo el proxy honra Range.
  res.setHeader('Cache-Control', 'no-store');
  // Progreso del transcode: sin total conocido (ffmpeg genera en vivo) → solo MB.
  const progress = progressLogger({ label, total: null, startedAt: Date.now() });
  if (child.stdout) {
    child.stdout.on('data', (chunk) => progress.add(chunk.length));
    child.stdout.pipe(res);
  }
  let aborted = false;
  let failed = false;
  child.on('error', () => {
    failed = true;
    if (!res.headersSent) res.status(500).json({ success: false, error: 'ffmpeg error' });
  });
  req.on('close', () => {
    aborted = true; // el cliente se fue → no fue una finalización natural
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  });
  child.on('close', () => {
    if (aborted || failed) progress.abort();
    else progress.finish();
    res.end();
  });
}

// ── Handler de la ruta /api/music/stream ──
export async function handleStreamRequest(req, res, { artist = '', title = '', duration = 0, fresh = false } = {}) {
  const startedAt = Date.now();
  const label = `${artist} - ${title}`.trim() || 'stream';
  try {
    const resolved = await resolveStream({ artist, title, duration }, { fresh });
    if (!resolved?.url) {
      res.status(404).json({ success: false, error: 'No stream found' });
      return;
    }
    const resolveSecs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const playable = isBrowserPlayableMime(resolved.mime);
    console.info(
      `[music-stream] ▶ ${label} · resolución ${resolveSecs}s · ${resolved.mime || 'mime?'} · ${playable ? 'proxy' : 'transcode'}`
    );
    if (playable) proxyStream(req, res, resolved.url, label);
    else transcodeStream(req, res, resolved.url, label);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
  }
}

// ── Pre-warm: cooldown por query + tope de procesos concurrentes ──
// El pre-warm NO pasa por el rate-limit HTTP (llama a resolveStream en
// proceso), así que se protege el celular: no re-resolver la misma query en
// 60s y máximo 1 yt-dlp en background (evita saturar CPU/batería al buscar).
const prewarmCooldown = new Map(); // query → lastAt
let prewarmInFlight = 0;
const PREWARM_COOLDOWN_MS = 60_000;
const PREWARM_MAX_INFLIGHT = 1;

function shouldPrewarm(key) {
  const now = Date.now();
  const last = prewarmCooldown.get(key);
  if (last && now - last < PREWARM_COOLDOWN_MS) return false;
  if (prewarmInFlight >= PREWARM_MAX_INFLIGHT) return false;
  prewarmCooldown.set(key, now);
  if (prewarmCooldown.size > 200) prewarmCooldown.clear(); // poda ocasional
  prewarmInFlight += 1;
  return true;
}

// ── Búsqueda combinada: Deezer (metadatos) + disponibilidad de stream ──
export async function combinedMusicSearch(query, limit = 10) {
  const tracks = await searchMusicServer(query, 'deezer', limit);
  const health = await getMusicHealth();
  const results = tracks.map((t) => ({ ...t, streamable: !!(t.artist && t.title) }));
  // Pre-warm: resolver en background el stream del primer resultado (el que
  // más probablemente elija el usuario) para que al darle play ya esté en
  // caché → primer play casi instantáneo. Fire-and-forget: la respuesta no
  // espera. Gated por health?.ytdlp (en Vercel sin yt-dlp se salta).
  const top = results[0];
  if (health?.ytdlp && top?.artist && top?.title) {
    const queryKey = `${top.artist} - ${top.title}`.toLowerCase();
    if (shouldPrewarm(queryKey)) {
      resolveStream({ artist: top.artist, title: top.title, duration: top.duration })
        .then(() => console.info('[music-stream] pre-resuelto:', `${top.artist} - ${top.title}`))
        .catch(() => { /* silencioso: el play normal lo reintentará */ })
        .finally(() => { prewarmInFlight -= 1; });
    }
  }
  return { success: true, provider: 'deezer', stream: !!(health?.ytdlp && health?.ffmpeg), results };
}

// ── Health: binarios disponibles ──
let healthCache = { at: 0, data: null };

function hasBinary(bin, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve(false);
    }, 4000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function getMusicHealth({ ttlMs = 60000 } = {}) {
  const now = Date.now();
  if (healthCache.data && now - healthCache.at < ttlMs) return healthCache.data;
  const [ytdlp, ffmpeg] = await Promise.all([
    hasBinary(YTDLP_BIN, ['--version']),
    hasBinary(FFMPEG_BIN, ['-version']),
  ]);
  const data = { ok: ytdlp && ffmpeg, ytdlp, ffmpeg };
  if (ytdlp) {
    try {
      const { stdout } = await runYtDlp(['--version']);
      data.ytdlpVersion = stdout.trim().split('\n')[0] || null;
    } catch { /* ignore */ }
  }
  healthCache = { at: Date.now(), data };
  return data;
}
