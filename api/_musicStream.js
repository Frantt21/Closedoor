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
import http from 'http';
import https from 'https';
import { searchMusicServer } from './_music.js';

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── Ejecutar yt-dlp (con timeout y límite de buffer) ──
function runYtDlp(args, { timeoutMs = 30000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(YTDLP_BIN, ['--no-warnings', '--no-call-home', '--js-runtimes', 'node', ...args], {
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
export async function resolveBestAudioUrl(videoUrl) {
  const { stdout } = await runYtDlp([
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
    '--get-url',
    '--no-playlist',
    videoUrl,
  ]);
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//.test(l));
  if (!line) throw new Error('No audio URL resolved');
  return line;
}

// ── Cache de URLs resueltas (TTL corto: expiran ~6h y están ligadas a IP) ──
// - Las entradas expiradas se ELIMINAN al accederlas (el Map no crece sin límite).
// - `inflight` deduplica resoluciones concurrentes de la misma canción
//   (evita spawns de yt-dlp en paralelo cuando varios usuarios la reproducen).
const STREAM_CACHE_TTL = 15 * 60 * 1000;
const streamCache = new Map();
const inflightStream = new Map();

export async function resolveStream({ artist = '', title, duration }, { fresh = false } = {}) {
  if (!title) throw new Error('Missing title');
  const query = [String(artist || '').trim(), String(title).trim()].filter(Boolean).join(' - ') || String(title);
  const key = query.toLowerCase();
  const hit = streamCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < STREAM_CACHE_TTL) {
    return { url: hit.url, mime: hit.mime, videoTitle: hit.videoTitle, videoId: hit.videoId };
  }
  streamCache.delete(key); // entrada (si existe) expirada → liberar
  if (!fresh && inflightStream.has(key)) return inflightStream.get(key);

  const p = (async () => {
    const candidates = await searchYoutubeCandidates(query, 5);
    const best = pickBestCandidate(candidates, { artist: String(artist || ''), title: String(title), duration: Number(duration) || 0 });
    if (!best) throw new Error('No YouTube candidate found');
    const url = await resolveBestAudioUrl(best.url);
    const mime = getMimeFromUrl(url);
    streamCache.set(key, { url, mime, at: Date.now(), videoTitle: best.title, videoId: best.id });
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

// ── Proxy del stream con soporte de Range ──
export function proxyStream(req, res, url) {
  let parsed;
  try {
    parsed = new URL(url);
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
export function transcodeStream(req, res, url) {
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
  if (child.stdout) child.stdout.pipe(res);
  child.on('error', () => {
    if (!res.headersSent) res.status(500).json({ success: false, error: 'ffmpeg error' });
  });
  child.on('close', () => res.end());
  req.on('close', () => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  });
}

// ── Handler de la ruta /api/music/stream ──
export async function handleStreamRequest(req, res, { artist = '', title = '', duration = 0, fresh = false } = {}) {
  try {
    const resolved = await resolveStream({ artist, title, duration }, { fresh });
    if (!resolved?.url) {
      res.status(404).json({ success: false, error: 'No stream found' });
      return;
    }
    if (isBrowserPlayableMime(resolved.mime)) proxyStream(req, res, resolved.url);
    else transcodeStream(req, res, resolved.url);
  } catch (err) {
    console.warn('[music-stream]', err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: err.message });
  }
}

// ── Búsqueda combinada: Deezer (metadatos) + disponibilidad de stream ──
export async function combinedMusicSearch(query, limit = 10) {
  const tracks = await searchMusicServer(query, 'deezer', limit);
  const health = await getMusicHealth();
  return {
    success: true,
    provider: 'deezer',
    stream: !!(health?.ytdlp && health?.ffmpeg),
    results: tracks.map((t) => ({ ...t, streamable: !!(t.artist && t.title) })),
  };
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
