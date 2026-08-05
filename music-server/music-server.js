#!/usr/bin/env node
/**
 * music-server.js — Server de música STANDALONE con auto-setup.
 *
 * Descarga automáticamente yt-dlp y ffmpeg al iniciar si no existen.
 * No requiere shell access — solo subir los archivos y hacer npm install.
 */

import http from 'http';
import https from 'https';
import { existsSync, mkdirSync, chmodSync, createWriteStream, unlinkSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { combinedMusicSearch, getMusicHealth, handleStreamRequest } from './api/_musicStream.js';
import { resolveTrackPreview } from './api/_music.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, 'bin');

// ── Auto-detectar arquitectura ──
function getArch() {
  if (process.platform !== 'linux') return null;
  switch (process.arch) {
    case 'x64': return 'x86_64';
    case 'arm64': return 'aarch64';
    case 'arm': return 'armv7l';
    default: return null;
  }
}

// ── Descargar archivo ──
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = createWriteStream(dest);
    proto.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { unlinkSync(dest); } catch {}
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        try { unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { try { unlinkSync(dest); } catch {} reject(err); });
    }).on('error', (err) => { file.close(); try { unlinkSync(dest); } catch {} reject(err); });
  });
}

// ── Extraer tar.xz ──
function extractTarXz(tarball, destDir, pattern) {
  return new Promise((resolve, reject) => {
    // --wildcards es necesario para usar * en el patrón
    const child = spawn('tar', ['xf', tarball, '-C', destDir, '--strip-components=1', '--wildcards', pattern], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}: ${stderr.slice(0, 200)}`)));
    child.on('error', reject);
  });
}

// ── Auto-setup ──
async function autoSetup() {
  const arch = getArch();
  if (!arch) {
    console.warn('[setup] ⚠️ Arquitectura no soportada:', process.arch, process.platform);
    console.warn('[setup]   Asegúrate de tener yt-dlp y ffmpeg en PATH');
    return;
  }

  mkdirSync(BIN_DIR, { recursive: true });

  const ytdlpPath = join(BIN_DIR, 'yt-dlp');
  const ffmpegPath = join(BIN_DIR, 'ffmpeg');

  // ── yt-dlp ──
  // Formato correcto: yt-dlp_linux_aarch64 (guión bajo)
  if (!existsSync(ytdlpPath)) {
    const version = '2025.06.09';
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp_linux_${arch}`;
    console.log(`[setup] 📦 Descargando yt-dlp ${version} (${arch})...`);
    try {
      await downloadFile(url, ytdlpPath);
      chmodSync(ytdlpPath, 0o755);
      console.log('[setup] ✅ yt-dlp instalado');
    } catch (err) {
      console.warn(`[setup] ❌ Error descargando yt-dlp: ${err.message}`);
    }
  }

  // ── ffmpeg ──
  // Formato: ffmpeg-VERSION-ARCH-static.tar.xz
  if (!existsSync(ffmpegPath)) {
    const ffmpegUrl = arch === 'aarch64'
      ? 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz'
      : 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
    console.log(`[setup] 📦 Descargando ffmpeg (${arch})...`);
    try {
      const tmpFile = `/tmp/ffmpeg-${arch}.tar.xz`;
      await downloadFile(ffmpegUrl, tmpFile);
      // El tarball contiene: ffmpeg-VERSION-ARCH-static/ffmpeg
      // Usamos --strip-components=1 y glob para extraer solo ffmpeg
      await extractTarXz(tmpFile, BIN_DIR, '*/ffmpeg');
      chmodSync(ffmpegPath, 0o755);
      try { unlinkSync(tmpFile); } catch {}
      console.log('[setup] ✅ ffmpeg instalado');
    } catch (err) {
      console.warn(`[setup] ❌ Error descargando ffmpeg: ${err.message}`);
    }
  }

  console.log(`[setup] yt-dlp: ${existsSync(ytdlpPath) ? '✅' : '❌'} | ffmpeg: ${existsSync(ffmpegPath) ? '✅' : '❌'}`);
}

const PORT = process.env.PORT || 24633;

// ── CORS ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
}

// ── Shims Express-lite ──
function adapt(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  return res;
}

// ── Rate limit ──
const streamLimits = new Map();
function rateLimitStream(req) {
  const ip = req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = streamLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    streamLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  if (streamLimits.size > 5000) streamLimits.clear();
  return entry.count <= 15;
}

// ── Main ──
// ── Detectar binarios (DESPUÉS de auto-setup) ──
function findBinary(envVar, localName, systemName) {
  if (process.env[envVar]) return process.env[envVar];
  const localPath = join(BIN_DIR, localName);
  if (existsSync(localPath)) return localPath;
  return systemName;
}

async function main() {
  // Auto-setup: descargar binarios si no existen
  await autoSetup();

  // Detectar binarios DESPUÉS de auto-setup (ya existen en ./bin/)
  const ytdlpBin = findBinary('YTDLP_BIN', 'yt-dlp', 'yt-dlp');
  const ffmpegBin = findBinary('FFMPEG_BIN', 'ffmpeg', 'ffmpeg');
  if (!process.env.YTDLP_BIN) process.env.YTDLP_BIN = ytdlpBin;
  if (!process.env.FFMPEG_BIN) process.env.FFMPEG_BIN = ffmpegBin;

  const server = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    adapt(res);

    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.status(400).json({ success: false, error: 'Invalid request URL' });
      return;
    }

    try {
      if (url.pathname === '/api/music/health') {
        res.status(200).json(await getMusicHealth());
        return;
      }

      if (url.pathname === '/api/music/search') {
        const trackId = url.searchParams.get('track');
        if (trackId) {
          try {
            const previewUrl = await resolveTrackPreview(trackId, 'deezer');
            res.status(200).json({ success: true, provider: 'deezer', previewUrl });
          } catch (err) {
            console.warn('[music-server]', err.message);
            res.status(502).json({ success: false, error: err.message });
          }
          return;
        }

        const q = (url.searchParams.get('q') || '').trim();
        if (!q) {
          res.status(400).json({ success: false, error: 'Missing ?q parameter' });
          return;
        }
        const data = await combinedMusicSearch(q, url.searchParams.get('limit'));
        res.status(200).json(data);
        return;
      }

      if (url.pathname === '/api/music/stream') {
        const artist = url.searchParams.get('artist') || '';
        const title = url.searchParams.get('title') || '';
        const duration = url.searchParams.get('duration') || 0;
        const fresh = url.searchParams.get('fresh') === '1';
        if (!title) {
          res.status(400).json({ success: false, error: 'Missing ?title parameter' });
          return;
        }
        if (!rateLimitStream(req)) {
          res.status(429).json({ success: false, error: 'Too many stream requests, try again in a minute' });
          return;
        }
        await handleStreamRequest(req, res, { artist, title, duration, fresh });
        return;
      }

      res.status(404).json({
        success: false,
        error: 'Not found. Endpoints: /api/music/health, /api/music/search?q=..., /api/music/stream?artist=&title=',
      });
    } catch (err) {
      console.warn('[music-server]', err.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      else res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`🎧 Music server (yt-dlp + ffmpeg) en http://localhost:${PORT}`);
    console.log(`   Plataforma: ${process.platform} ${process.arch}`);
    console.log(`   yt-dlp: ${process.env.YTDLP_BIN} ${existsSync(process.env.YTDLP_BIN) ? '✅' : '❌'}`);
    console.log(`   ffmpeg: ${process.env.FFMPEG_BIN} ${existsSync(process.env.FFMPEG_BIN) ? '✅' : '❌'}`);
    console.log('   /api/music/health · /api/music/search?q=... · /api/music/stream?artist=&title=');
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
