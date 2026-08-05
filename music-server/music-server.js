#!/usr/bin/env node
/**
 * music-server.js — Server de música STANDALONE con auto-setup.
 *
 * Descarga automáticamente yt-dlp y ffmpeg al iniciar si no existen.
 * No requiere shell access — solo subir los archivos y hacer npm install.
 */

import http from 'http';
import https from 'https';
import { existsSync, mkdirSync, chmodSync, createWriteStream, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { combinedMusicSearch, getMusicHealth, handleStreamRequest, handleDownloadRequest, resolveStream, detectedCookiesFile } from './api/_musicStream.js';
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
  // Siempre descargar la versión más reciente si no existe o es muy vieja.
  // La versión 2025.06.09 no puede extraer formatos de YouTube en 2026.
  const YT_DLP_VERSION = '2026.07.04';
  let needYtdlp = !existsSync(ytdlpPath);
  if (!needYtdlp) {
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        const child = spawn(ytdlpPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout?.on('data', (d) => { out += d; });
        child.stderr?.on('data', (d) => { err += d; });
        child.on('close', (code) => code === 0 ? resolve({ stdout: out }) : reject(new Error(err)));
        child.on('error', reject);
      });
      const installedVersion = stdout.trim().split('\n')[0];
      if (installedVersion < YT_DLP_VERSION) {
        console.log(`[setup] 📦 yt-dlp ${installedVersion} obsoleto → actualizando a ${YT_DLP_VERSION}...`);
        needYtdlp = true;
      }
    } catch { needYtdlp = true; }
  }
  if (needYtdlp) {
    // Binary específico por arquitectura (compilado standalone, no necesita Python)
    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux_${arch}`;
    console.log(`[setup] 📦 Descargando yt-dlp ${YT_DLP_VERSION} (${arch})...`);
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

  // ── PO Token provider (anti-bot para IPs de datacenter) ──
  // YouTube requiere PO Tokens para extraer formatos desde IPs de datacenter.
  // Sin ellos, yt-dlp devuelve "Requested format is not available".
  const bgutilPath = join(BIN_DIR, 'bgutil-pot');
  const pluginsDir = join(__dirname, 'yt-dlp-plugins');
  const potPluginDir = join(pluginsDir, 'bgutil-ytdlp-pot-provider');
  const POT_VERSION = 'v0.8.1';
  
  if (!existsSync(bgutilPath)) {
    const potUrl = arch === 'aarch64'
      ? `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-pot-linux-aarch64`
      : `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-pot-linux-x86_64`;
    console.log(`[setup] 📦 Descargando PO Token provider (${arch})...`);
    try {
      await downloadFile(potUrl, bgutilPath);
      chmodSync(bgutilPath, 0o755);
      console.log('[setup] ✅ PO Token provider instalado');
    } catch (err) {
      console.warn(`[setup] ⚠️ No se pudo descargar PO Token provider: ${err.message}`);
    }
  }
  
  // Descargar plugin de yt-dlp si no existe
  // Los plugins DEBEN estar en un directorio que yt-dlp escanee:
  //   1. Junto al binario: ./bin/yt-dlp-plugins/
  //   2. ~/.config/yt-dlp-plugins/
  //   3. ~/yt-dlp-plugins/
  const binPluginsDir = join(BIN_DIR, 'yt-dlp-plugins');
  const binPotPluginDir = join(binPluginsDir, 'bgutil-ytdlp-pot-provider');
  if (!existsSync(binPotPluginDir) && existsSync(bgutilPath)) {
    const pluginZipUrl = `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-ytdlp-pot-provider-rs.zip`;
    const tmpZip = `/tmp/bgutil-pot-plugin.zip`;
    console.log('[setup] 📦 Descargando PO Token plugin para yt-dlp...');
    try {
      await downloadFile(pluginZipUrl, tmpZip);
      mkdirSync(binPluginsDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const child = spawn('unzip', ['-o', tmpZip, '-d', binPluginsDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr?.on('data', (d) => { stderr += d; });
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(0, 200))));
        child.on('error', reject);
      });
      try { unlinkSync(tmpZip); } catch {}
      console.log('[setup] ✅ PO Token plugin instalado');
    } catch (err) {
      console.warn(`[setup] ⚠️ No se pudo instalar PO Token plugin: ${err.message}`);
    }
  }
  
  // Iniciar servidor PO Token en background si el binario existe
  if (existsSync(bgutilPath) && !process.env.BGUTIL_POT_PORT) {
    try {
      const potServer = spawn(bgutilPath, ['server', '--port', '4416'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      potServer.unref();
      // Configurar yt-dlp para usar el provider
      process.env.BGUTIL_POT_BASE_URL = 'http://127.0.0.1:4416';
      console.log('[setup] ✅ PO Token server iniciado en puerto 4416');
    } catch (err) {
      console.warn(`[setup] ⚠️ No se pudo iniciar PO Token server: ${err.message}`);
    }
  }

  // ── cloudflared (túnel HTTPS automático, sin root) ──
  // Exponer el server HTTP interno por HTTPS (https://xxx.trycloudflare.com).
  // El frontend detecta la URL vía /health en runtime → sin redeploy.
  // Solo hace conexiones salientes → NO necesita root ni abrir puertos.
  // Desactivable con CLOUDFLARED_DISABLE=1; URL estable con CLOUDFLARED_URL.
  const cloudflaredPath = join(BIN_DIR, 'cloudflared');
  const needCloudflared =
    !existsSync(cloudflaredPath) &&
    process.env.CLOUDFLARED_DISABLE !== '1' &&
    !process.env.CLOUDFLARED_URL;
  if (needCloudflared) {
    const cfUrl = arch === 'aarch64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    console.log(`[setup] 📦 Descargando cloudflared (${arch})...`);
    try {
      await downloadFile(cfUrl, cloudflaredPath);
      chmodSync(cloudflaredPath, 0o755);
      console.log('[setup] ✅ cloudflared instalado');
    } catch (err) {
      console.warn(`[setup] ⚠️ No se pudo descargar cloudflared: ${err.message}`);
    }
  }

  console.log(`[setup] yt-dlp: ${existsSync(ytdlpPath) ? '✅' : '❌'} | ffmpeg: ${existsSync(ffmpegPath) ? '✅' : '❌'} | pot: ${existsSync(bgutilPath) ? '✅' : '❌'} | cf: ${existsSync(cloudflaredPath) ? '✅' : '❌'}`);
}

const PORT = process.env.PORT || 24633;

// ── CORS ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, ngrok-skip-browser-warning');
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

// ── Túnel HTTPS automático (cloudflared) ──
// Guarda el PID y la URL en archivos para reutilizar entre reinicios.
const TUNNEL_URL_FILE = join(__dirname, '.tunnel-url.txt');
const TUNNEL_PID_FILE = join(__dirname, '.tunnel.pid');

function readTunnelUrl() {
  try {
    if (existsSync(TUNNEL_URL_FILE)) {
      const u = readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
      if (u && /^https?:\/\//.test(u)) return u.replace(/\/+$/, '');
    }
  } catch {}
  return null;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function startTunnel(port) {
  return new Promise((resolve) => {
    // Desactivado por env var
    if (process.env.CLOUDFLARED_DISABLE === '1') return resolve(null);
    // URL estable configurada manualmente (p. ej. music.foranly.space) → no
    // hace falta túnel dinámico; se registra la URL tal cual.
    if (process.env.CLOUDFLARED_URL) {
      const stable = String(process.env.CLOUDFLARED_URL).trim().replace(/\/+$/, '');
      if (stable) {
        try { writeFileSync(TUNNEL_URL_FILE, stable, 'utf8'); } catch {}
        return resolve(stable);
      }
    }
    const cloudflaredPath = join(BIN_DIR, 'cloudflared');
    if (!existsSync(cloudflaredPath)) return resolve(null);

    // Túnel ya corriendo (arranque anterior) → reutilizarlo.
    let pid = null;
    try { pid = Number(readFileSync(TUNNEL_PID_FILE, 'utf8')); } catch {}
    if (isProcessAlive(pid)) {
      const existing = readTunnelUrl();
      if (existing) return resolve(existing);
      // Vive pero sin URL registrada aún (arranque interrumpido): esperar a que
      // la registre — NO lanzar un segundo cloudflared (túnel huérfano).
      const deadline = Date.now() + 25000;
      const poll = () => {
        const u = readTunnelUrl();
        if (u) return resolve(u);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(poll, 2000);
      };
      poll();
      return;
    }

    const child = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.unref();
    try { writeFileSync(TUNNEL_PID_FILE, String(child.pid), 'utf8'); } catch {}

    let resolved = false;
    const finish = (url) => { if (!resolved) { resolved = true; resolve(url); } };
    const onData = (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        try { writeFileSync(TUNNEL_URL_FILE, m[0], 'utf8'); } catch {}
        finish(m[0]);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', () => finish(null));
    child.on('error', () => finish(null));
    // Si tarda en asignar URL, no bloqueamos el arranque: el túnel sigue
    // corriendo y la URL queda registrada cuando Cloudflare la asigne.
    setTimeout(() => {
      const u = readTunnelUrl();
      if (u) {
        finish(u);
        console.log(`   tunnel HTTPS (tarde): ${u} ✅`);
      } else {
        finish(null);
      }
    }, 25000);
  });
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

      if (url.pathname === '/api/music/download') {
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
        await handleDownloadRequest(req, res, { artist, title, duration, fresh });
        return;
      }

      // Pre-warm: resuelve la URL de audio (yt-dlp) y la cachea SIN descargar.
      // El frontend lo llama al montar la card → el play posterior arranca al
      // instante (sin los 5-30s de resolución).
      if (url.pathname === '/api/music/resolve') {
        const artist = url.searchParams.get('artist') || '';
        const title = url.searchParams.get('title') || '';
        const duration = url.searchParams.get('duration') || 0;
        if (!title) {
          res.status(400).json({ success: false, error: 'Missing ?title parameter' });
          return;
        }
        try {
          await resolveStream({ artist, title, duration });
          res.status(200).json({ success: true });
        } catch (err) {
          console.warn('[music-server] resolve:', err.message);
          res.status(502).json({ success: false, error: err.message });
        }
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
    console.log(`   cookies: ${detectedCookiesFile ? detectedCookiesFile + ' ✅' : '⚠️ no detectadas (coloca cookies.txt junto a music-server.js)'}`);
    console.log('   /api/music/health · /api/music/search?q=... · /api/music/stream?artist=&title= · /api/music/download?artist=&title= · /api/music/resolve?artist=&title=');

    // Túnel HTTPS automático (cloudflared): sin root, solo conexión saliente.
    startTunnel(PORT).then((tunnelUrl) => {
      if (tunnelUrl) {
        console.log(`   tunnel HTTPS: ${tunnelUrl} ✅`);
        console.log('   El frontend detecta esta URL vía /api/music/health (sin redeploy).');
      } else if (process.env.CLOUDFLARED_DISABLE === '1') {
        console.log('   tunnel HTTPS: desactivado (CLOUDFLARED_DISABLE=1) → la app usa preview 30s');
      } else if (!existsSync(join(BIN_DIR, 'cloudflared')) && !process.env.CLOUDFLARED_URL) {
        console.log('   tunnel HTTPS: no disponible (cloudflared no descargado) → la app usa preview 30s');
      } else {
        console.log('   tunnel HTTPS: aún sin URL asignada (se registra en .tunnel-url.txt al llegar)');
      }
    });
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
