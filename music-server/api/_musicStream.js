/**
 * api/_musicStream.js — Streaming de canciones completas (yt-dlp + ffmpeg).
 *
 * Arquitectura combinada:
 *   - Metadatos:  Deezer (título, artista, álbum, portada, DURACIÓN).
 *   - Stream:     YouTube vía yt-dlp — se busca `ytsearch:"artista - título"`,
 *                 se elige el mejor candidato por similitud de título + duración
 *                 y se resuelve la URL de audio directa (m4a preferido).
 *   - Servido:    las URLs directas de googlevideo expiran y están ligadas a la
 *                 IP del server → se PROXIAN con soporte de Range.
 *
 * ⚠️ Requiere yt-dlp + ffmpeg en ./bin/ o en PATH.
 * Variables: YTDLP_BIN, FFMPEG_BIN, YTDLP_COOKIES_FILE.
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, writeFile, mkdirSync, renameSync, unlinkSync, statSync, readdirSync } from 'fs';
import http from 'http';
import https from 'https';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { searchMusicServer } from './_music.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// ── Detectar binarios ──
// Orden de precedencia:
//   1. Variable de entorno (YTDLP_BIN / FFMPEG_BIN)
//   2. ./bin/ (descargado por setup.sh)
//   3. ~/.local/bin/ (instalación local sin sudo)
//   4. PATH del sistema
const localBin = join(ROOT_DIR, 'bin');

function findBinary(envVar, localName, systemName) {
  // 1. Env var
  if (process.env[envVar]) return process.env[envVar];
  // 2. ./bin/
  const localPath = join(localBin, localName);
  if (existsSync(localPath)) return localPath;
  // 3. ~/.local/bin/
  const homePath = join(homedir(), '.local', 'bin', localName);
  if (existsSync(homePath)) return homePath;
  // 4. PATH
  return systemName;
}

const YTDLP_BIN = findBinary('YTDLP_BIN', 'yt-dlp', 'yt-dlp');
const FFMPEG_BIN = findBinary('FFMPEG_BIN', 'ffmpeg', 'ffmpeg');
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Cookies de cuenta logueada (ANTI-THROTTLE) ──
const localCookies = join(homedir(), '.config', 'yt-dlp', 'cookies.txt');
const containerCookies = join(ROOT_DIR, 'cookies.txt');
const YTDLP_COOKIES_FILE = (() => {
  const fromEnv = process.env.YTDLP_COOKIES_FILE || '';
  if (fromEnv && !existsSync(fromEnv)) {
    console.warn(`[music-stream] ⚠️ YTDLP_COOKIES_FILE no existe: ${fromEnv} → sin cookies`);
    // Buscar en ./cookies.txt (container) o ~/.config/yt-dlp/cookies.txt
    if (existsSync(containerCookies)) return containerCookies;
    return existsSync(localCookies) ? localCookies : '';
  }
  if (fromEnv) return fromEnv;
  if (existsSync(containerCookies)) return containerCookies;
  return existsSync(localCookies) ? localCookies : '';
})();

// Exportado para que music-server.js pueda loguear el estado
export const detectedCookiesFile = YTDLP_COOKIES_FILE;

// ── YouTube client chain + anti-bot ──
// IPs de datacenter requieren PO Tokens para extraer formatos. Sin PO Tokens,
// YouTube devuelve "Requested format is not available" para TODOS los selectores.
// Estrategia: usar clients menos restringidos + player_skip=webpage para reducir
// la huella de detección. Los clients embebidos y mediaconnect son los más
// tolerantes con IPs de datacenter.
const YTDLP_CLIENTS = (() => {
  if (process.env.YTDLP_EXTRACTOR_ARGS) {
    return process.env.YTDLP_EXTRACTOR_ARGS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const base = [
    // mediaconnect: client nuevo, menos restricciones en datacenters
    'youtube:player_client=mediaconnect;player_skip=webpage,configs',
    // web_embedded: client embebido, tolera más IPs
    'youtube:player_client=web_embedded;player_skip=webpage,configs',
    // mweb: mobile web, menos bloqueado
    'youtube:player_client=mweb;player_skip=webpage,configs',
    // tv_embedded: smart TV client, bypasses many checks
    'youtube:player_client=tv_embedded;player_skip=webpage,configs',
    // android: fallback final
    'youtube:player_client=android;player_skip=webpage,configs',
  ];
  return base;
})();

// ── Ejecutar yt-dlp ──
const YTDLP_PLUGINS_DIR = join(ROOT_DIR, 'bin', 'yt-dlp-plugins');
function runYtDlp(args, { timeoutMs = 30000, maxBuffer = 8 * 1024 * 1024, skipCookies = false, verbose = false } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    const baseArgs = verbose ? ['--verbose', '--no-warnings'] : ['--no-warnings'];
    // --js-runtimes node: necesario para extraer formatos de YouTube en versiones recientes
    baseArgs.push('--js-runtimes', 'node');
    // PO Token plugin: indicar directorio de plugins si existe
    if (existsSync(YTDLP_PLUGINS_DIR)) {
      baseArgs.push('--plugin-dirs', YTDLP_PLUGINS_DIR);
    }
    // PO Token server URL (si está configurado)
    if (process.env.BGUTIL_POT_BASE_URL) {
      baseArgs.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${process.env.BGUTIL_POT_BASE_URL}`);
    }
    if (!skipCookies && YTDLP_COOKIES_FILE) baseArgs.push('--cookies', YTDLP_COOKIES_FILE);
    try {
      child = spawn(YTDLP_BIN, [...baseArgs, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) { reject(err); return; }

    let stdout = '', stderr = '', settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('yt-dlp timeout'));
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBuffer) {
        finish(reject, new Error('yt-dlp output too large'));
        try { child.kill('SIGKILL'); } catch {}
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

// ── Candidatos de YouTube ──
export async function searchYoutubeCandidates(query, limit = 5) {
  const capped = Math.max(1, Math.min(parseInt(limit, 10) || 5, 10));
  const { stdout } = await runYtDlp(['--flat-playlist', '-J', `ytsearch${capped}:${query}`]);
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error('yt-dlp search returned invalid JSON'); }
  return (data.entries || [])
    .map((e) => ({
      id: e?.id || null,
      title: e?.title || '',
      duration: Number(e?.duration) || null,
      url: e?.url || (e?.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
    }))
    .filter((e) => e.url && e.title);
}

// ── Matching ──
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function pickBestCandidate(candidates, { title, artist, duration }) {
  const titleNorm = normalizeText(title);
  const artistNorm = normalizeText(artist);
  let best = null, bestScore = -1;

  for (const c of candidates) {
    const cNorm = normalizeText(c.title);
    const cTokens = cNorm.split(' ').filter(Boolean);
    const titleTokens = new Set(titleNorm.split(' ').filter(Boolean));
    let score = 0;

    if (cTokens.length && titleTokens.size) {
      const hits = cTokens.filter((tok) => titleTokens.has(tok)).length;
      score += (hits / Math.max(cTokens.length, 1)) * 5;
    }
    if (artistNorm && cNorm.includes(artistNorm)) score += 2;
    if (duration && c.duration) {
      const diff = Math.abs(duration - c.duration);
      if (diff <= 5) score += 4;
      else if (diff <= 15) score += 2;
      else if (diff <= 60) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || candidates[0] || null;
}

// ── Resolver URL de audio ──
export async function resolveBestAudioUrl(videoUrl) {
  // Selector ULTRA-permisivo: intenta todo, incluyendo video+audio
  const run = (extra, opts = {}) => runYtDlp([
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/bestvideo[ext=m4a]+bestaudio/best',
    '--get-url', '--no-playlist',
    ...extra, videoUrl,
  ], opts);
  const parseUrl = (stdout) => stdout.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//.test(l));

  // Intentar con cookies (si disponibles) — primer intento verbose para diagnosticar
  let isFirstAttempt = true;
  for (const client of YTDLP_CLIENTS) {
    try {
      const { stdout, stderr } = await run(['--extractor-args', client], isFirstAttempt ? { verbose: true, timeoutMs: 45000 } : {});
      if (isFirstAttempt && stderr) {
        // Loguear info del plugin PO Token si está presente
        const potLines = stderr.split('\n').filter(l => l.includes('[pot]') || l.includes('PO Token') || l.includes('plugin'));
        if (potLines.length) console.info('[music-stream] PO Token info:', potLines.slice(0, 3).join(' | '));
      }
      isFirstAttempt = false;
      const line = parseUrl(stdout);
      if (line) {
        console.info(`[music-stream] resuelto con client: ${client.replace('youtube:player_client=', '')}`);
        return line;
      }
    } catch {}
  }
  const { stdout } = await run([]);
  const line = parseUrl(stdout);
  if (line) return line;

  // Fallback: intentar SIN cookies (puede que las cookies estén causando el problema)
  if (YTDLP_COOKIES_FILE) {
    console.warn('[music-stream] intentando sin cookies...');
    const runNoCookies = (extra) => runYtDlp([
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best',
      '--get-url', '--no-playlist',
      ...extra, videoUrl,
    ], { timeoutMs: 30000, skipCookies: true });
    try {
      const { stdout: out2 } = await runNoCookies([]);
      const line2 = parseUrl(out2);
      if (line2) {
        console.info('[music-stream] resuelto SIN cookies');
        return line2;
      }
    } catch {}
  }

  throw new Error('No audio URL resolved');
}

// ── Cache de URLs ──
const STREAM_CACHE_TTL = 4 * 60 * 60 * 1000;
const CACHE_VERSION = `v3-cookies-${YTDLP_COOKIES_FILE ? 'yes' : 'no'}`;
const streamCache = new Map();
const inflightStream = new Map();
const DISK_CACHE_FILE = join(ROOT_DIR, '.music-stream-cache.json');

function loadDiskCache() {
  try {
    if (!existsSync(DISK_CACHE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(DISK_CACHE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.__version !== CACHE_VERSION) {
      try { writeFileSync(DISK_CACHE_FILE, JSON.stringify({ __version: CACHE_VERSION }), 'utf8'); } catch {}
      return null;
    }
    return parsed;
  } catch { return null; }
}

function persistCache() {
  try {
    const now = Date.now();
    const entries = { __version: CACHE_VERSION };
    let n = 0;
    for (const [k, v] of streamCache) {
      if (!v?.url || now - v.at >= STREAM_CACHE_TTL) { streamCache.delete(k); continue; }
      if (n < 50) { entries[k] = v; n += 1; }
    }
    writeFileSync(DISK_CACHE_FILE, JSON.stringify(entries), 'utf8');
  } catch {}
}

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
  if (!fresh && hit && hit.__v === CACHE_VERSION && Date.now() - hit.at < STREAM_CACHE_TTL) {
    return { url: hit.url, mime: hit.mime, videoTitle: hit.videoTitle, videoId: hit.videoId };
  }
  streamCache.delete(key);
  if (!fresh && inflightStream.has(key)) return inflightStream.get(key);

  const p = (async () => {
    const candidates = await searchYoutubeCandidates(query, 5);
    const best = pickBestCandidate(candidates, { artist: String(artist || ''), title: String(title), duration: Number(duration) || 0 });
    if (!best) throw new Error('No YouTube candidate found');
    if (YTDLP_COOKIES_FILE) console.info(`[music-stream] usando cookies de: ${YTDLP_COOKIES_FILE}`);
    const url = await resolveBestAudioUrl(best.url);
    const mime = getMimeFromUrl(url);
    streamCache.set(key, { url, mime, at: Date.now(), __v: CACHE_VERSION, videoTitle: best.title, videoId: best.id });
    persistCache();
    return { url, mime, videoTitle: best.title, videoId: best.id };
  })();
  inflightStream.set(key, p);
  try { return await p; } finally { if (inflightStream.get(key) === p) inflightStream.delete(key); }
}

// ── Detección de mime ──
function getMimeFromUrl(url) {
  try {
    const u = new URL(url);
    const mime = u.searchParams.get('mime');
    if (mime) return decodeURIComponent(mime);
  } catch {}
  const extMatch = url.match(/\.(m4a|mp4|webm|ogg|opus|aac)(?:[?#]|$)/i);
  if (extMatch) {
    const map = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac' };
    return map[extMatch[1].toLowerCase()] || null;
  }
  return null;
}

function isBrowserPlayableMime(mime) {
  if (!mime) return true;
  const m = String(mime).toLowerCase();
  return m.startsWith('audio/mp4') || m === 'audio/aac' || m === 'audio/x-m4a' || m === 'audio/m4a';
}

// ── Logs de progreso ──
function formatMB(bytes) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function formatSpeed(bytesPerSec) {
  if (!isFinite(bytesPerSec) || bytesPerSec < 0) return '';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function progressLogger({ label, total, startedAt }) {
  let sent = 0, lastLogAt = 0, lastPct = 0, done = false, lastSent = null, lastTime = null;
  const emit = (mark) => {
    if (done) return;
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
      console.info(`[music-stream] ${label} · ${formatMB(sent)}${total ? ` / ${formatMB(total)} (${pct}%)` : ''} · ${((now - startedAt) / 1000).toFixed(1)}s${speedStr}`);
    },
    finish: () => emit('COMPLETO'),
    abort: () => emit('ABORTADO'),
  };
}

// ── Proxy del stream ──
export function withRateBypass(url) {
  try {
    const u = new URL(url);
    if (/googlevideo/i.test(u.hostname)) { u.searchParams.set('ratebypass', 'yes'); return u.toString(); }
    return url;
  } catch { return url; }
}

export function proxyStream(req, res, url, label = 'proxy') {
  const target = withRateBypass(url);
  let parsed;
  try { parsed = new URL(target); } catch { res.status(400).json({ success: false, error: 'Invalid stream URL' }); return; }
  const lib = parsed.protocol === 'https:' ? https : http;
  const headers = { 'User-Agent': UA };
  if (req.headers.range) headers.Range = req.headers.range;

  const proxyReq = lib.request(parsed, { method: 'GET', headers }, (upRes) => {
    res.status(upRes.statusCode || 200);
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'].forEach((h) => {
      const v = upRes.headers[h]; if (v !== undefined) res.setHeader(h, v);
    });
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
  proxyReq.setTimeout(30000, () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).json({ success: false, error: 'Stream proxy timeout' }); });
  req.on('close', () => proxyReq.destroy());
  proxyReq.end();
}

// ── Transcode streaming ──
export function transcodeStream(req, res, url, label = 'transcode') {
  let child;
  try {
    child = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-user_agent', UA,
      '-i', url,
      '-vn', '-acodec', 'aac', '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { res.status(500).json({ success: false, error: 'ffmpeg unavailable' }); return; }
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Cache-Control', 'no-store');
  const progress = progressLogger({ label, total: null, startedAt: Date.now() });
  if (child.stdout) { child.stdout.on('data', (chunk) => progress.add(chunk.length)); child.stdout.pipe(res); }
  let aborted = false, failed = false;
  child.on('error', () => { failed = true; if (!res.headersSent) res.status(500).json({ success: false, error: 'ffmpeg error' }); });
  req.on('close', () => { aborted = true; try { child.kill('SIGKILL'); } catch {} });
  child.on('close', () => { if (aborted || failed) progress.abort(); else progress.finish(); res.end(); });
}

// ── Handler /api/music/stream ──
export async function handleStreamRequest(req, res, { artist = '', title = '', duration = 0, fresh = false } = {}) {
  const startedAt = Date.now();
  const label = `${artist} - ${title}`.trim() || 'stream';
  try {
    const resolved = await resolveStream({ artist, title, duration }, { fresh });
    if (!resolved?.url) { res.status(404).json({ success: false, error: 'No stream found' }); return; }
    const resolveSecs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const playable = isBrowserPlayableMime(resolved.mime);
    console.info(`[music-stream] ▶ ${label} · resolución ${resolveSecs}s · ${resolved.mime || 'mime?'} · ${playable ? 'proxy' : 'transcode'}`);
    if (playable) proxyStream(req, res, resolved.url, label);
    else transcodeStream(req, res, resolved.url, label);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
  }
}

// ── Descarga con caché en memoria ──
// El disco de este container escribe a ~36KB/s y FRENABA el stream (80-100s de
// espera). Ahora los bytes van al cliente según llegan de googlevideo (sin
// backpressure de disco, igual que el proxy local → play en ~1s) y se cachean
// EN MEMORIA (instantáneo). El disco solo se usa en background para persistir
// entre reinicios — las LECTURAS de disco sí son rápidas.
const MEM_AUDIO_MAX = 12;
const DOWNLOAD_CACHE_DIR = join(ROOT_DIR, '.music-cache');
const DOWNLOAD_CACHE_MAX_FILES = 25;

function sanitizeFileKey(key) {
  return Buffer.from(String(key)).toString('base64url').slice(0, 80);
}
function downloadCachePath(key) {
  return join(DOWNLOAD_CACHE_DIR, `${sanitizeFileKey(key)}.m4a`);
}
function evictDownloadCache() {
  try {
    const files = readdirSync(DOWNLOAD_CACHE_DIR)
      .map((f) => {
        const p = join(DOWNLOAD_CACHE_DIR, f);
        try { return { p, mtime: statSync(p).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime);
    while (files.length > DOWNLOAD_CACHE_MAX_FILES) {
      const oldest = files.shift();
      try { unlinkSync(oldest.p); } catch {}
    }
  } catch {}
}

// ── Caché de audio en memoria ──
const memAudioCache = new Map(); // key → { buf, at }

function getMemAudio(key) {
  const e = memAudioCache.get(key);
  return e && e.buf ? e.buf : null;
}
function setMemAudio(key, buf) {
  memAudioCache.set(key, { buf, at: Date.now() });
  if (memAudioCache.size > MEM_AUDIO_MAX) {
    let oldestKey = null, oldestAt = Infinity;
    for (const [k, v] of memAudioCache) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    if (oldestKey) memAudioCache.delete(oldestKey);
  }
}

// Escritura a disco EN BACKGROUND (lenta ~36KB/s pero no bloquea a nadie).
function persistAudioToDisk(cachePath, buf) {
  const tmp = `${cachePath}.part`;
  writeFile(tmp, buf, (err) => {
    if (err) { try { unlinkSync(tmp); } catch {} return; }
    try { renameSync(tmp, cachePath); } catch { try { unlinkSync(tmp); } catch {} }
  });
}

// Sirve un Buffer completo (memoria o leído de disco).
function serveBuffer(res, buf) {
  res.status(200);
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(buf);
}

// Descarga PROGRESIVA sin backpressure de disco: envía los bytes al cliente en
// cuanto llegan de googlevideo. No envía headers hasta recibir el PRIMER byte
// (si la URL está muerta —googlevideo 0 bytes— se detecta antes de mandar nada
// y el handler reintenta con resolución fresca). Al terminar cachea en memoria
// y persiste a disco en background.
function streamDownloadToResponse(res, url, cachePath, key) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(withRateBypass(url)); } catch { reject(new Error('Invalid stream URL')); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    const out = lib.get(parsed, { headers: { 'User-Agent': UA } }, (upRes) => {
      if (upRes.statusCode !== 200) {
        upRes.resume();
        reject(new Error(`download HTTP ${upRes.statusCode}`));
        return;
      }
      const startedAt = Date.now();
      let started = false, finished = false, total = 0;
      const chunks = [];
      const firstByteTimer = setTimeout(() => {
        // Sin datos en 12s → URL muerta (googlevideo 0 bytes)
        out.destroy(new Error('No audio data from source'));
      }, 12000);
      upRes.on('data', (chunk) => {
        clearTimeout(firstByteTimer);
        if (!started) {
          started = true;
          if (!res.destroyed) {
            res.status(200);
            res.setHeader('Content-Type', upRes.headers['content-type'] || 'audio/mp4');
            if (upRes.headers['content-length'] !== undefined) {
              res.setHeader('Content-Length', upRes.headers['content-length']);
            }
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        }
        chunks.push(chunk);
        total += chunk.length;
        if (res.destroyed || res.writableEnded) return;
        if (res.write(chunk) === false) { upRes.pause(); res.once('drain', () => upRes.resume()); }
      });
      upRes.on('end', () => {
        clearTimeout(firstByteTimer);
        finished = true;
        if (total === 0) {
          // 200 vacío (googlevideo 0 bytes) → dispara el reintento con resolución fresca
          reject(new Error('Empty response from source'));
          return;
        }
        const buf = Buffer.concat(chunks, total);
        setMemAudio(key, buf);
        persistAudioToDisk(cachePath, buf); // background
        if (!res.destroyed) res.end();
        console.info(`[music-stream] audio servido · ${(total / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        resolve();
      });
      upRes.on('error', (err) => { clearTimeout(firstByteTimer); finished = true; reject(err); });
      // Aborto a mitad de transferencia sin 'end' ni 'error' → no dejar colgada la promesa.
      upRes.on('close', () => {
        if (!finished) { clearTimeout(firstByteTimer); reject(new Error('Download aborted')); }
      });
      // Cliente se desconecta con backpressure activo → seguir descargando para cachear.
      res.on('close', () => { if (!upRes.destroyed) upRes.resume(); });
    });
    out.on('error', (err) => reject(err));
    out.setTimeout(120000, () => out.destroy(new Error('download timeout')));
  });
}

// Transcodifica (webm/opus → m4a 128k) PROGRESIVAMENTE: envía al cliente y
// cachea en memoria + disco en background al terminar.
function streamTranscodeToResponse(res, url, cachePath, key) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'error',
        '-user_agent', UA,
        '-i', withRateBypass(url),
        '-vn', '-acodec', 'aac', '-b:a', '128k',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) { reject(err); return; }
    const startedAt = Date.now();
    let started = false, finished = false, total = 0;
    const chunks = [];
    const firstByteTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('No audio data from ffmpeg'));
    }, 12000);
    child.stdout?.on('data', (chunk) => {
      clearTimeout(firstByteTimer);
      if (!started) {
        started = true;
        if (!res.destroyed) {
          res.status(200);
          res.setHeader('Content-Type', 'audio/mp4');
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
      }
      chunks.push(chunk);
      total += chunk.length;
      if (res.destroyed || res.writableEnded) return;
      if (res.write(chunk) === false) { child.stdout.pause(); res.once('drain', () => child.stdout.resume()); }
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(firstByteTimer); finished = true; reject(err); });
    child.on('close', (code) => {
      clearTimeout(firstByteTimer);
      finished = true;
      if (code === 0) {
        if (total === 0) { reject(new Error('Empty output from ffmpeg')); return; }
        const buf = Buffer.concat(chunks, total);
        setMemAudio(key, buf);
        persistAudioToDisk(cachePath, buf);
        if (!res.destroyed) res.end();
        console.info(`[music-stream] transcode servido · ${(total / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 150)}`));
      }
    });
    // Cliente se desconecta con backpressure activo → seguir cacheando.
    res.on('close', () => { if (child.stdout && !child.stdout.destroyed) child.stdout.resume(); });
  });
}

// ── Handler /api/music/download ──
const inflightDownload = new Map();

export async function handleDownloadRequest(req, res, { artist = '', title = '', duration = 0, fresh = false } = {}) {
  const startedAt = Date.now();
  const label = `${artist} - ${title}`.trim() || 'download';
  try {
    const t0 = Date.now();
    const resolved = await resolveStream({ artist, title, duration }, { fresh });
    const resolveSecs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!resolved?.url) { res.status(404).json({ success: false, error: 'No stream found' }); return; }

    const key = [String(artist || ''), String(title || '')].filter(Boolean).join(' - ').toLowerCase().trim() || String(title);
    const cachePath = downloadCachePath(key);
    mkdirSync(DOWNLOAD_CACHE_DIR, { recursive: true });

    if (fresh) memAudioCache.delete(key); // fresh fuerza regenerar también la memoria

    // 1) Caché en memoria → instantáneo.
    const mem = getMemAudio(key);
    if (mem) {
      serveBuffer(res, mem);
      console.info(`[music-stream] ⬇ ${label} · memoria ${(mem.length / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return;
    }

    // 2) Archivo en disco (persistido de reproducciones anteriores) → leer y cachear en memoria.
    let have = false;
    try { have = existsSync(cachePath) && statSync(cachePath).size > 0; } catch { have = false; }
    if (fresh && have) { try { unlinkSync(cachePath); } catch {} have = false; }
    if (have) {
      try {
        const diskBuf = readFileSync(cachePath);
        setMemAudio(key, diskBuf);
        serveBuffer(res, diskBuf);
        console.info(`[music-stream] ⬇ ${label} · disco ${(diskBuf.length / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        return;
      } catch { /* seguir con descarga */ }
    }

    // 3) Ya hay una descarga en vuelo → esperar y servir desde memoria.
    if (inflightDownload.has(key)) {
      await inflightDownload.get(key);
      const b = getMemAudio(key);
      if (b) { serveBuffer(res, b); return; }
      throw new Error('Background download failed');
    }

    const playable = isBrowserPlayableMime(resolved.mime);
    const doStream = () => (playable
      ? streamDownloadToResponse(res, resolved.url, cachePath, key)
      : streamTranscodeToResponse(res, resolved.url, cachePath, key)
    );
    let p = doStream();
    p = p
      .then(() => {
        console.info(`[music-stream] ⬇ ${label} · servido+${playable ? 'descargado' : 'transcodificado'} y cacheado · total ${((Date.now() - startedAt) / 1000).toFixed(1)}s (resolve ${resolveSecs}s)`);
        evictDownloadCache();
      })
      .catch(async (err) => {
        console.warn(`[music-stream] ✗ ${label} · ${err.message}`);
        // URL muerta (googlevideo 0 bytes) y aún sin headers → resolver fresca y reintentar una vez.
        if (!res.headersSent && !res.destroyed) {
          try {
            console.warn(`[music-stream] ↻ ${label} · reintentando con resolución fresca...`);
            const freshRes = await resolveStream({ artist, title, duration }, { fresh: true });
            if (freshRes?.url) {
              await (playable
                ? streamDownloadToResponse(res, freshRes.url, cachePath, key)
                : streamTranscodeToResponse(res, freshRes.url, cachePath, key));
              evictDownloadCache();
              return;
            }
          } catch (e2) {
            console.warn(`[music-stream] ✗ ${label} · reintento falló:`, e2.message);
          }
          if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
          else res.end();
          return;
        }
        if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
        else res.end();
      });
    inflightDownload.set(key, p);
    try { await p; } finally { inflightDownload.delete(key); }
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
  }
}

// ── Pre-warm ──
const prewarmCooldown = new Map();
let prewarmInFlight = 0;
const PREWARM_COOLDOWN_MS = 60_000;
const PREWARM_MAX_INFLIGHT = 1;

function shouldPrewarm(key) {
  const now = Date.now();
  const last = prewarmCooldown.get(key);
  if (last && now - last < PREWARM_COOLDOWN_MS) return false;
  if (prewarmInFlight >= PREWARM_MAX_INFLIGHT) return false;
  prewarmCooldown.set(key, now);
  if (prewarmCooldown.size > 200) prewarmCooldown.clear();
  prewarmInFlight += 1;
  return true;
}

// ── Búsqueda combinada ──
export async function combinedMusicSearch(query, limit = 10) {
  const tracks = await searchMusicServer(query, 'deezer', limit);
  const health = await getMusicHealth();
  const results = tracks.map((t) => ({ ...t, streamable: !!(t.artist && t.title) }));
  const top = results[0];
  if (health?.ytdlp && top?.artist && top?.title) {
    const queryKey = `${top.artist} - ${top.title}`.toLowerCase();
    if (shouldPrewarm(queryKey)) {
      resolveStream({ artist: top.artist, title: top.title, duration: top.duration })
        .then(() => console.info('[music-stream] pre-resuelto:', `${top.artist} - ${top.title}`))
        .catch(() => {})
        .finally(() => { prewarmInFlight -= 1; });
    }
  }
  return { success: true, provider: 'deezer', stream: !!(health?.ytdlp && health?.ffmpeg), results };
}

// ── Health ──
let healthCache = { at: 0, data: null };

function hasBinary(bin, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { stdio: 'ignore' }); } catch { resolve(false); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(false); }, 4000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

// ── Túnel HTTPS automático (cloudflared) ──
// La URL la escribe music-server.js en .tunnel-url.txt al arrancar el túnel.
// Se expone en /health para que el frontend la detecte en runtime (sin redeploy).
const TUNNEL_URL_FILE = join(ROOT_DIR, '.tunnel-url.txt');

export function getTunnelUrl() {
  try {
    if (existsSync(TUNNEL_URL_FILE)) {
      const u = readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
      if (u && /^https?:\/\//.test(u)) return u.replace(/\/+$/, '');
    }
  } catch {}
  return null;
}

export async function getMusicHealth({ ttlMs = 60000 } = {}) {
  const now = Date.now();
  if (healthCache.data && now - healthCache.at < ttlMs) return healthCache.data;
  const [ytdlp, ffmpeg] = await Promise.all([
    hasBinary(YTDLP_BIN, ['--version']),
    hasBinary(FFMPEG_BIN, ['-version']),
  ]);
  const data = {
    ok: ytdlp && ffmpeg,
    ytdlp,
    ffmpeg,
    ytdlpBin: YTDLP_BIN,
    ffmpegBin: FFMPEG_BIN,
    tunnelUrl: getTunnelUrl(),
  };
  if (ytdlp) {
    try { const { stdout } = await runYtDlp(['--version']); data.ytdlpVersion = stdout.trim().split('\n')[0] || null; } catch {}
  }
  healthCache = { at: Date.now(), data };
  return data;
}
