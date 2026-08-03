#!/usr/bin/env node
/**
 * music-server.js — Server de música STANDALONE (sin dependencias npm).
 *
 * Pensado para correr en un celular con Termux (o cualquier VPS) SOLO para
 * el streaming de la card "Mi canción": búsqueda en Deezer + stream completo
 * vía yt-dlp/ffmpeg. NO sirve el frontend ni toca Supabase.
 *
 * Solo necesita estos 3 archivos (cópialos a la carpeta y ejecuta):
 *   music-server.js
 *   api/_music.js
 *   api/_musicStream.js
 *
 * ⚠️ Si los copias a una carpeta FUERA del repo, añade un package.json con
 *    {"type":"module"} (los archivos usan import/export ESM):
 *      echo '{"type":"module"}' > package.json
 *
 * Uso:
 *   node music-server.js            # escucha en :3000 (PORT para cambiar)
 *
 * Endpoints (mismos que usa el frontend vía VITE_MUSIC_API_URL):
 *   GET /api/music/health                     → estado de yt-dlp/ffmpeg
 *   GET /api/music/search?q=...&limit=...     → Deezer (metadatos + flag stream)
 *   GET /api/music/search?track=...           → preview FRESCO de Deezer (expira)
 *   GET /api/music/stream?artist=&title=&duration=&fresh= → stream completo
 *
 * Variables opcionales: PORT, YTDLP_BIN, FFMPEG_BIN.
 * Requiere: Node 18+ (fetch global), yt-dlp y ffmpeg instalados.
 */

import http from 'http';
import { combinedMusicSearch, getMusicHealth, handleStreamRequest } from './api/_musicStream.js';
import { resolveTrackPreview } from './api/_music.js';

const PORT = process.env.PORT || 3000;

// ── CORS (el app desplegado consume el server cross-origin vía túnel) ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, ngrok-skip-browser-warning');
}

// ── Shims Express-lite sobre http.ServerResponse (res.status / res.json) ──
// Necesarios para reutilizar handleStreamRequest y los helpers de _musicStream.
function adapt(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    const body = JSON.stringify(obj);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
  };
  return res;
}

// ── Rate limit por IP para el stream (resolver yt-dlp es caro) ──
const streamLimits = new Map(); // ip → { count, resetAt }
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
  return entry.count <= 15; // máx 15 streams/min por IP
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
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
      // ── Modo track: resolver preview FRESCO de Deezer (los previews expiran
      //    ≈ 15 min) — Uso: GET /api/music/search?track=<id>&provider=deezer
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
  console.log('   /api/music/health · /api/music/search?q=... · /api/music/stream?artist=&title=');
});
