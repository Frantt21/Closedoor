#!/usr/bin/env node
/**
 * music-server.js — Server de música STANDALONE con auto-setup.
 *
 * Descarga automáticamente yt-dlp y ffmpeg al iniciar si no existen.
 * No requiere shell access — solo subir los archivos y hacer npm install.
 */

import http from 'http';
import https from 'https';
import dns from 'dns';
import { existsSync, mkdirSync, chmodSync, createWriteStream, unlinkSync, readFileSync, writeFileSync, rmSync, appendFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const dnsLookup = dns.promises.lookup;
import { combinedMusicSearch, getMusicHealth, handleStreamRequest, handleDownloadRequest, resolveStream, detectedCookiesFile, getProxyStatus, checkProxyReachability, autoConfigureProxy } from './api/_musicStream.js';
import { startTailscaleAutoSetup, startProxyWatchdog } from './api/_tailscaleSetup.js';
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
  // Re-aplicar el +x aunque exista: la subida por panel lo quita de TODOS los
  // binarios (EACCES en el spawn del transcode, que falla en silencio).
  try { chmodSync(ffmpegPath, 0o755); } catch {}
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
  const POT_VERSION = 'v0.8.1';
  const potUrl = arch === 'aarch64'
    ? `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-pot-linux-aarch64`
    : `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-pot-linux-x86_64`;

  // Verificación del binario PO Token provider.
  // IMPORTANTE (diagnóstico real): el binario oficial es DINÁMICO y exige
  // GLIBC_2.38 (verificado con readelf: interp /lib/ld-linux-aarch64.so.1 +
  // NEEDED libgcc_s/libm/libc). En containers con glibc más viejo o musl
  // (Alpine) NO ejecuta: `--version` sale con exit 1. Eso NO es truncamiento
  // (el archivo se descarga íntegro, 54.1MB) — por eso aquí se captura el
  // stderr real y se distingue 'corrupt' (tamaño corto → re-descargar) de
  // 'incompatible' (tamaño ok pero no ejecuta → NO re-descargar en bucle).
  const POT_EXPECTED_SIZE = { aarch64: 54147304, x86_64: 50990856 };
  const verifyPotBinary = async () => {
    if (!existsSync(bgutilPath)) return 'missing';
    // Auto-reparar permisos de ejecución: al copiar la carpeta al container
    // (subida por panel/zip) el bit +x se pierde fácilmente → spawn EACCES.
    // El chmod debe ir ANTES del spawn, no solo tras descargar.
    try { chmodSync(bgutilPath, 0o755); } catch {}
    let realSize = 0;
    try { realSize = statSync(bgutilPath).size; } catch {}
    const res = await new Promise((resolve) => {
      const c = spawn(bgutilPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      c.stdout?.on('data', (d) => { out += d; });
      c.stderr?.on('data', (d) => { err += d; });
      const to = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} resolve({ code: 'timeout', out, err }); }, 10000);
      c.on('close', (code) => { clearTimeout(to); resolve({ code, out, err }); });
      c.on('error', (e) => { clearTimeout(to); resolve({ code: 'spawn-error', out, err, msg: e.message }); });
    });
    if (res.code === 0) return 'ok';
    const expected = POT_EXPECTED_SIZE[arch];
    const firstLine = String(res.err || res.out || res.msg || '').toString().trim().split('\n')[0] || '';
    // EACCES tras el chmod → el binario NO tiene permiso de ejecución (el
    // filesystem del container lo niega) — distinto del clásico "glibc viejo".
    if (res.code === 'spawn-error' && /EACCES|permission denied/i.test(res.msg || '')) {
      console.warn(`[setup] ⚠️ PO Token provider SIN permiso de ejecución (EACCES) — el chmod 755 previo no tuvo efecto`);
      console.warn(`   ${firstLine}`);
      console.warn('      → el filesystem del container lo niega (¿montado con noexec, o el archivo es');
      console.warn('        root-owned sin escritura?). Copia el binario de nuevo: la subida por panel');
      console.warn('        suele quitar el +x, y el server ya lo re-aplica solo al arrancar.');
      return 'incompatible';
    }
    if (expected && realSize > 0 && realSize < expected) {
      // Descarga cortada → borrar y re-descargar (self-heal).
      console.warn(`[setup] ⚠️ PO Token provider corrupto: ${realSize} bytes (esperado ${expected}) → re-descargando...`);
      try { unlinkSync(bgutilPath); } catch {}
      return 'corrupt';
    }
    // Tamaño íntegro pero NO ejecuta → incompatibilidad de libc, no corrupción.
    console.warn(`[setup] ⚠️ PO Token provider NO EJECUTA en este container (--version exit ${res.code})${firstLine ? `:\n   ${firstLine}` : ''}`);
    console.warn('      → el binario oficial exige GLIBC_2.38 (dinámico). Si el container tiene glibc');
    console.warn('        más viejo o es Alpine/musl, hay que usar una imagen con glibc ≥ 2.38');
    console.warn('        (p. ej. node:23-trixie, node:24, ubuntu:24.04) o un build estático.');
    return 'incompatible';
  };

  const downloadPotBinary = async () => {
    console.log(`[setup] 📦 Descargando PO Token provider (${arch})...`);
    await downloadFile(potUrl, bgutilPath);
    chmodSync(bgutilPath, 0o755);
  };

  // potOk = el binario existe y ejecuta → solo entonces arrancar el server.
  // (variable global: la usa también checkPotServer para relanzar si se cae)
  potOk = false;
  try {
    let state = existsSync(bgutilPath) ? await verifyPotBinary() : 'missing';
    if (state === 'missing' || state === 'corrupt') {
      await downloadPotBinary();
      state = await verifyPotBinary();
      if (state === 'ok') console.log('[setup] ✅ PO Token provider instalado');
      else console.warn('[setup] ⚠️ PO Token provider no usable; se reintentará en el próximo arranque');
    }
    potOk = state === 'ok';
  } catch (err) {
    console.warn(`[setup] ⚠️ No se pudo descargar PO Token provider: ${err.message}`);
  }
  
  // Descargar plugin de yt-dlp si no existe.
  // ⚠️ IMPORTANTE (yt-dlp ≥2025): el sistema de plugins exige que cada plugin
  // viva en SU PROPIA CARPETA dentro del --plugin-dirs, con yt_dlp_plugins/
  // DENTRO. Extraer el zip "plano" (yt_dlp_plugins/ suelto en el dir) NO carga
  // el plugin → yt-dlp reporta "PO Token Providers: none" y el bot-check de
  // YouTube (IP de datacenter) no se puede esquivar. Estructura correcta:
  //   bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider/yt_dlp_plugins/extractor/*.py
  const binPluginsDir = join(BIN_DIR, 'yt-dlp-plugins');
  const binPotPluginDir = join(binPluginsDir, 'bgutil-ytdlp-pot-provider');
  // Gate por ARCHIVO (no por carpeta): si una instalación falló a medias
  // (mkdir creado pero unzip roto), la carpeta vacía no debe bloquear el
  // reintento en el próximo arranque.
  const potProviderFile = join(binPotPluginDir, 'yt_dlp_plugins', 'extractor', 'getpot_bgutil_http.py');
  if (!existsSync(potProviderFile) && potOk) {
    const pluginZipUrl = `https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/download/${POT_VERSION}/bgutil-ytdlp-pot-provider-rs.zip`;
    const tmpZip = `/tmp/bgutil-pot-plugin.zip`;
    console.log('[setup] 📦 Descargando PO Token plugin para yt-dlp...');
    try {
      await downloadFile(pluginZipUrl, tmpZip);
      mkdirSync(binPotPluginDir, { recursive: true });
      await new Promise((resolve, reject) => {
        const child = spawn('unzip', ['-o', tmpZip, '-d', binPotPluginDir], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  // Migración: si una instalación anterior dejó yt_dlp_plugins/ "plano" (roto,
  // sin carpeta envolvente), limpiarlo para que el escaneo no se confunda.
  if (existsSync(binPotPluginDir)) {
    try {
      const legacyFlat = join(binPluginsDir, 'yt_dlp_plugins');
      if (existsSync(legacyFlat)) rmSync(legacyFlat, { recursive: true, force: true });
    } catch {}
  }
  
  // Iniciar servidor PO Token en background si el binario existe Y ejecuta.
  // ⚠️ "spawn OK" NO significa "puerto escuchando": el binario embebe un
  // navegador y tarda segundos en arrancar; si muere al inicio o el puerto está
  // ocupado por una instancia rota previa, el ping falla para siempre. Este
  // bloque reutiliza una instancia sana, mata una instancia vieja sin responder,
  // y registra su salida en bin/bgutil-pot.log (crash = visible).
  if (potOk && !process.env.BGUTIL_POT_PORT) {
    const base = 'http://127.0.0.1:4416';
    const port = '4416';
    const potPidFile = join(BIN_DIR, '.bgutil-pot.pid');

    // 1) Ya responde (instancia de un arranque anterior aún viva) → reutilizar.
    if (await pingPot(base, 1500)) {
      console.log(`[setup] ✅ PO Token server ya respondiendo en ${base} (reutilizado)`);
      process.env.BGUTIL_POT_BASE_URL = base;
    } else {
      // 2) PID viejo vivo pero sin responder → instancia rota ocupando el puerto;
      //    matarla antes de lanzar una nueva (si no, la nueva muere por EADDRINUSE).
      //    ⚠️ Seguridad: el PID reciclado podría apuntar a OTRO proceso — solo se
      //    mata si /proc/<pid>/cmdline contiene 'bgutil-pot' (identidad verificada).
      let oldPid = null;
      try { oldPid = Number(readFileSync(potPidFile, 'utf8')); } catch {}
      if (oldPid && isProcessAlive(oldPid) && isPotProcess(oldPid)) {
        try { process.kill(oldPid, 'SIGKILL'); } catch {}
        console.log(`[setup] ♻️  PO Token server previo (pid ${oldPid}) sin responder → reiniciado`);
        await sleep(400);
      }
      // 3) Lanzar el server (con --verbose + log de stdout/stderr → crash visible).
      spawnPotServer(port);
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

  console.log(`[setup] yt-dlp: ${existsSync(ytdlpPath) ? '✅' : '❌'} | ffmpeg: ${existsSync(ffmpegPath) ? '✅' : '❌'} | pot: ${potOk ? '✅' : '❌'} | cf: ${existsSync(cloudflaredPath) ? '✅' : '❌'}`);
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

// ── Rate limit del proxy de imágenes ──
// Endpoint público → límite por IP (60/min) para evitar abuso de ancho de
// banda del proxy abierto (imágenes grandes de terceros).
const imageProxyLimits = new Map();
function rateLimitImageProxy(req) {
  const ip = req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = imageProxyLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    imageProxyLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  if (imageProxyLimits.size > 5000) imageProxyLimits.clear();
  return entry.count <= 60;
}

// ── Anti-SSRF del proxy de imágenes ──
// Comprueba la IP REAL resuelta (no solo el string del host): cubre
// IPv4-mapped IPv6 (::ffff:127.0.0.1), shorthand (127.1, decimal), IPs
// privadas y de metadata. Los nombres internos (metadata, *.internal,
// *.local) se rechazan directamente.
const PRIVATE_IP_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|0\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

async function isHostAllowed(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (
    h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' ||
    h === '169.254.169.254' || h === 'metadata' || h === 'metadata.google.internal' ||
    h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')
  ) return false;
  // Resolver la IP real: cubre formas que el string no revela.
  try {
    const { address } = await dnsLookup(h, { family: 0 });
    if (PRIVATE_IP_RE.test(address)) return false;
    if (address.startsWith('fe80') || address.startsWith('fd') || address.startsWith('fc')) return false; // link-local/ULA IPv6
    if (address.startsWith('::ffff:')) {
      const v4 = address.slice(7);
      if (PRIVATE_IP_RE.test(v4)) return false;
    }
    return true;
  } catch {
    return false; // no resuelve → rechazar
  }
}

const MAX_IMAGE_PROXY_BYTES = 20 * 1024 * 1024; // 20MB tope por imagen

// ── Main ──
// ── Detectar binarios (DESPUÉS de auto-setup) ──
function findBinary(envVar, localName, systemName) {
  if (process.env[envVar]) return process.env[envVar];
  const localPath = join(BIN_DIR, localName);
  if (existsSync(localPath)) return localPath;
  return systemName;
}

// ── Diagnóstico de cookies (bot-check "Sign in to confirm you're not a bot") ──
// YouTube pide login aunque se pase --cookies cuando el archivo está mal
// formado o NO incluye las cookies de autenticación (SID, __Secure-3PSID,
// LOGIN_INFO, HSID, SSID, APISID, SAPISID, __Secure-3PAPISID). Muchos
// exportadores solo guardan las no-HttpOnly → el archivo existe y parece
// "reciente" pero no sirve para nada. Este check lo dice claro al arrancar.
function logCookiesDiagnostics() {
  if (!detectedCookiesFile || !existsSync(detectedCookiesFile)) {
    console.warn('   cookies: ❌ no detectadas (coloca cookies.txt junto a music-server.js)');
    return;
  }
  try {
    const raw = readFileSync(detectedCookiesFile, 'utf8');
    let total = 0;
    const names = new Set();
    for (let line of raw.split('\n')) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length).trimStart();
      else if (line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length < 7) continue;
      total += 1;
      names.add(parts[5]);
    }
    const critical = ['SID', '__Secure-3PSID', 'LOGIN_INFO', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-3PAPISID'];
    const found = critical.filter((c) => names.has(c));
    const missing = critical.filter((c) => !names.has(c));
    if (total > 0 && found.length > 0) {
      console.log(`   cookies: ✅ ${detectedCookiesFile} · ${total} cookies · auth: ${found.join(', ')}`);
    } else {
      console.warn(`   cookies: ⚠️ ${detectedCookiesFile} · ${total} cookies detectadas pero FALTAN las de autenticación (${missing.join(', ')})`);
      console.warn('      → YouTube pedirá login (bot check) aunque exista el archivo.');
      console.warn('      → Exporta cookies.txt con un método que incluya HttpOnly (extensión "Get cookies.txt LOCALLY" o yt-dlp --cookies-from-browser).');
    }
  } catch (err) {
    console.warn(`   cookies: ⚠️ error leyendo archivo: ${err.message}`);
  }
}

// ── Detecta el libc del container (glibc vs musl + versión) ──
// El binario bgutil-pot es dinámico y exige GLIBC_2.38. Si el container es
// Alpine (musl) o tiene glibc más viejo, el binario NO ejecuta. Esto imprime
// la distro y el libc para que el motivo sea visible sin adivinar.
function detectLibc() {
  let osLine = '';
  try {
    const release = readFileSync('/etc/os-release', 'utf8');
    const pretty = release.split('\n').find((l) => l.startsWith('PRETTY_NAME='));
    if (pretty) osLine = pretty.slice('PRETTY_NAME='.length).replace(/"/g, '').trim();
  } catch {}
  const check = () => {
    try {
      const child = spawn('ldd', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { out += d; });
      child.on('close', () => {
        const first = String(out).trim().split('\n')[0] || '';
        console.log(`   libc: ${first || 'no detectado'}${osLine ? ` · ${osLine}` : ''}`);
      });
      child.on('error', () => {
        console.log(`   libc: no detectado${osLine ? ` · ${osLine}` : ''}`);
      });
    } catch {
      console.log(`   libc: no detectado${osLine ? ` · ${osLine}` : ''}`);
    }
  };
  check();
}

// ── Diagnóstico del plugin PO Token (anti bot-check en IPs de datacenter) ──
function logPotPluginDiagnostics() {
  const providerFile = join(BIN_DIR, 'yt-dlp-plugins', 'bgutil-ytdlp-pot-provider', 'yt_dlp_plugins', 'extractor', 'getpot_bgutil_http.py');
  if (existsSync(providerFile)) {
    console.log('   PO Token plugin: ✅ bgutil:http registrado (esquiva el bot-check en IPs de datacenter)');
  } else {
    console.warn('   PO Token plugin: ⚠️ no instalado o estructura rota → el bot-check de YouTube puede fallar aunque haya cookies');
  }
}

// ── Ping al servidor bgutil-pot (sin lanzar excepciones) ──
function pingPot(base, timeoutMs = 2500) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(`${base}/ping`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return { ok: false, err: `HTTP ${res.status}` };
        let version = '';
        try { version = (await res.json()).version || ''; } catch {}
        return { ok: true, version };
      })
      .catch((err) => ({ ok: false, err: err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message) }))
      .finally(() => clearTimeout(t));
  } catch {
    return Promise.resolve({ ok: false, err: 'error' });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Comprueba que el servidor bgutil-pot (puerto 4416) responde ──
// El provider bgutil:http necesita ese server para generar PO tokens. Si está
// caído, el bot-check no se puede esquivar aunque el plugin esté instalado y
// las cookies sean válidas. El binario embebe un navegador → tarda en arrancar
// (más en arm64): la espera inicial es de 30s y, si falla, se reintenta en
// background por si arranca tarde o se cae y vuelve.
// ── Estado global del POT server (lo usan autoSetup y checkPotServer) ──
let potOk = false;
let lastPotSpawnAt = 0;
let potSpawnCount = 0;
const POT_SPAWN_COOLDOWN_MS = 60000;   // mínimo entre reintentos
const POT_SPAWN_MAX_TOTAL = 10;        // tope TOTAL anti-bucle (boot + reintentos, nunca decae)

// ── Lanzar el server POT ──
// Con --verbose (el log por defecto es info) y capturando stdout+stderr en
// bin/bgutil-pot.log: un crash deja la causa EXACTA visible (antes el log
// salía vacío porque los logs de Rust van a stdout y solo mirábamos stderr).
// El pid file permite a checkPotServer saber si el proceso sigue vivo.
function spawnPotServer(port = '4416') {
  const bgutilPath = join(BIN_DIR, 'bgutil-pot');
  const base = `http://127.0.0.1:${port}`;
  const potPidFile = join(BIN_DIR, '.bgutil-pot.pid');
  const potLogFile = join(BIN_DIR, 'bgutil-pot.log');
  // Re-asegurar el bit +x antes de cada spawn (la subida por panel lo quita).
  try { chmodSync(bgutilPath, 0o755); } catch {}
  lastPotSpawnAt = Date.now();
  potSpawnCount += 1;
  // Rotar el log si crece (--verbose escribe cada request).
  try { if (statSync(potLogFile).size > 1_000_000) writeFileSync(potLogFile, ''); } catch {}

  const child = spawn(bgutilPath, ['server', '--port', port, '--verbose'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.unref();
  let tail = '';
  const onData = (d) => {
    tail = (tail + d).slice(-2000);
    try { appendFileSync(potLogFile, d); } catch {}
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code, sig) => {
    if (code !== 0 || sig) {
      console.warn(`[setup] ⚠️ PO Token server salió (${sig ? `signal ${sig}` : `code ${code}`}) → mira ${potLogFile}`);
      console.warn(`   → último output: ${tail.trim().slice(-250) || '(vacío)'}`);
    }
    // Limpiar el pid file SOLO si sigue apuntando a ESTE proceso (race: un
    // arranque posterior pudo escribir el pid de una instancia nueva).
    try {
      if (Number(readFileSync(potPidFile, 'utf8')) === child.pid) unlinkSync(potPidFile);
    } catch {}
  });
  try { writeFileSync(potPidFile, String(child.pid), 'utf8'); } catch {}
  process.env.BGUTIL_POT_BASE_URL = base;
  console.log(`[setup] ✅ PO Token server iniciado en puerto ${port} (pid ${child.pid})`);
  return child;
}

// ── Comprueba que el servidor bgutil-pot (puerto 4416) responde ──
// El provider bgutil:http necesita ese server para generar PO tokens. Si está
// caído, el bot-check no se puede esquivar aunque el plugin esté instalado y
// las cookies sean válidas. El binario tarda en arrancar: espera inicial de
// 30s y, si el server se cae después (OOM, crash), lo RELANZA solo con
// cooldown + tope para no entrar en bucle infinito.
function checkPotServer() {
  const base = process.env.BGUTIL_POT_BASE_URL || 'http://127.0.0.1:4416';
  const potPidFile = join(BIN_DIR, '.bgutil-pot.pid');
  let ok = false;
  let lastErr = 'sin respuesta';

  const potProcessAlive = () => {
    try {
      const pid = Number(readFileSync(potPidFile, 'utf8'));
      return pid ? isProcessAlive(pid) : false;
    } catch { return false; }
  };

  let deadPings = 0; // pings fallidos consecutivos con el proceso vivo (colgado)
  const tryRespawn = () => {
    if (!potOk) return;
    if (Date.now() - lastPotSpawnAt < POT_SPAWN_COOLDOWN_MS) return;
    if (potSpawnCount >= POT_SPAWN_MAX_TOTAL) return;
    if (potProcessAlive()) {
      // Vivo pero sin responder → colgado. Tras 3 ciclos (~60s) matarlo con
      // identidad verificada (isPotProcess) para que el cooldown lo relance.
      deadPings += 1;
      if (deadPings >= 3) {
        deadPings = 0;
        try {
          const pid = Number(readFileSync(potPidFile, 'utf8'));
          if (pid && isProcessAlive(pid) && isPotProcess(pid)) {
            process.kill(pid, 'SIGKILL');
            console.warn(`   PO Token server colgado (pid ${pid}) → SIGKILL para relanzarlo`);
          }
        } catch {}
      }
      return; // esperar al siguiente ciclo
    }
    deadPings = 0;
    console.warn('   PO Token server caído → relanzándolo...');
    spawnPotServer('4416');
  };

  (async () => {
    // Fase 1: espera inicial (hasta 30s) — el server tarda en arrancar.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !ok) {
      const r = await pingPot(base);
      if (r.ok) {
        ok = true;
        console.log(`   PO Token server: ✅ ${base} responde${r.version ? ` (${r.version})` : ''}`);
        return;
      }
      lastErr = r.err;
      await sleep(2000);
    }
    if (ok) return;
    const alive = potProcessAlive();
    console.warn(`   PO Token server: ⚠️ ${base} no responde · ${alive ? 'proceso iniciado pero' : 'proceso NO corriendo'} · ${lastErr}`);
    console.warn('      → mira bin/bgutil-pot.log (ahora con --verbose) para la causa exacta.');
    console.warn('        Si murió con SIGKILL y el log quedó cortado → posible OOM: revisa la RAM');
    console.warn('        del container (free -m) y sube el límite si está justo.');
    // Fase 2: reintento + auto-reparación (si se cae, relanza solo, con tope).
    const iv = setInterval(async () => {
      const r = await pingPot(base);
      if (r.ok && !ok) {
        ok = true;
        console.log(`   PO Token server: ✅ ${base} responde ahora${r.version ? ` (${r.version})` : ''} → PO tokens OK`);
        clearInterval(iv);
        return;
      }
      lastErr = r.err;
      tryRespawn();
    }, 20000);
  })();
}

// ── Auto-configuración del proxy (Termux/Tailscale) — SIN consola ──
// Si no hay YTDLP_PROXY/proxy.conf, se DELEGA en _tailscaleSetup.js, que hace
// todo solo: descarga el binario Tailscale, arranca el daemon userspace, lanza
// el login (imprime el link en los logs), espera a que el usuario autentique y
// detecta el teléfono. onProxyReady re-ejecuta autoConfigureProxy() (que ya
// consulta la tailnet local) para escribir proxy.conf + aplicar el agente.
async function autoConfigureProxyDiagnostics() {
  // onProxyReady({ force }) — force=true cuando el watchdog detecta un proxy
  // configurado pero NO alcanzable (teléfono dormido/IP vieja): fuerza la
  // re-detección del teléfono y actualiza proxy.conf (sin esto, autoConfigureProxy
  // haría early-return y nunca re-detectaría una IP nueva).
  const onProxyReady = async ({ force = false } = {}) => {
    try {
      const r = await autoConfigureProxy({ force });
      if (r.configured) {
        console.log(`   proxy: auto-configurado (${r.source}) → ${r.url}`);
        checkProxyReachability().then((rr) => {
          if (rr.reachable) console.log(`   proxy: ✅ alcanzable vía ${r.url} → YouTube verá IP residencial`);
          else console.warn(`   proxy: ⚠️ configurado pero NO responde todavía (${rr.error || 'sin datos'}) — el watchdog lo reintentará`);
        }).catch(() => {});
      } else {
        console.warn('   proxy: sin configurar — el auto-setup de Tailscale está en marcha en background');
        console.warn(`      → ${r.error || 'sin detalles'}`);
      }
    } catch (err) {
      console.warn('   proxy: auto-configuración falló:', err.message);
    }
  };
  // Arranque: si ya hay proxy → nada que hacer. Si no → auto-setup completo
  // (descarga/daemon/login) en background, y watchdog de reconexión.
  const alreadyConfigured = () => !!(getProxyStatus().configured);
  const reachable = () => checkProxyReachability().then((r) => r.reachable);
  // El watchdog siempre arranca (también con proxy ya configurado): si el
  // túnel cae (teléfono offline/IP cambiada), re-detecta con force.
  startProxyWatchdog({ onProxyReady, checkProxyConfigured: alreadyConfigured, checkReachable: reachable, intervalMs: 60000 });
  if (alreadyConfigured()) return;
  startTailscaleAutoSetup({ onProxyReady, checkProxyConfigured: alreadyConfigured });
}

// ── Diagnóstico del proxy (Termux/Tailscale o residencial) ──
// Solo informativo: no bloquea el arranque. Prueba el túnel con una petición
// HTTPS real (generate_204 de Google, ~1KB) y reporta si YouTube vería una IP
// residencial (el bot-check desaparece) o si el túnel está caído.
function checkProxyDiagnostics() {
  const st = getProxyStatus();
  if (!st.configured) {
    console.warn('   proxy: ❌ sin configurar todavía → resolve/media salen por la IP del container');
    console.warn('      → el auto-setup de Tailscale está en marcha en background (sin consola):');
    console.warn('        descarga el binario, arranca el daemon y te imprime el link de login en los logs.');
    console.warn('        Abre ese link en el navegador con la MISMA cuenta del teléfono (termux-phone) y');
    console.warn('        el server escribirá proxy.conf solo. Detalles: TERMUX_PROXY.md');
    return;
  }
  console.log(`   proxy: ${st.url} (${st.scheme})`);
  checkProxyReachability().then((r) => {
    if (r.reachable) {
      console.log(`   proxy: ✅ alcanzable vía ${st.url} → YouTube verá IP residencial`);
    } else {
      console.warn(`   proxy: ⚠️ configurado pero NO responde (${r.error || 'sin datos'})`);
      console.warn('      → revisa que el teléfono (Termux) esté online y el túnel Tailscale activo');
    }
  }).catch(() => {});
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

// ── ¿El proceso del pid es realmente bgutil-pot? ──
// Protección ante PID reciclado: un pid file viejo podría apuntar a un proceso
// inocente con ese mismo PID tras un reinicio. Solo se debe matar si el
// ejecutable (primer token del cmdline) es exactamente bgutil-pot.
function isPotProcess(pid) {
  if (!pid) return false;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const exe = cmdline.split('\0')[0] || '';
    return exe.includes('bgutil-pot') || exe.includes('/bgutil-pot');
  } catch { return false; }
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

      // ── Proxy de imágenes CORS (GET /api/image-proxy?url=...) ──
      // Algunos dominios bloquean el fetch del navegador (CORS) o el
      // hotlinking (wallhaven 403). Este proxy baja la imagen DESDE el
      // server (sin Origin header → esos dominios responden 200) y la
      // devuelve con CORS * para que el navegador pueda leerla (p. ej.
      // extracción de colores para el contraste del fondo de perfil).
      if (url.pathname === '/api/image-proxy') {
        const target = url.searchParams.get('url') || '';
        if (!target) {
          res.status(400).json({ success: false, error: 'Missing ?url parameter' });
          return;
        }
        let parsedTarget;
        try {
          parsedTarget = new URL(target);
        } catch {
          res.status(400).json({ success: false, error: 'Invalid URL' });
          return;
        }
        if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
          res.status(400).json({ success: false, error: 'Only http/https URLs are allowed' });
          return;
        }
        if (!rateLimitImageProxy(req)) {
          res.status(429).json({ success: false, error: 'Too many image proxy requests, try again in a minute' });
          return;
        }
        // Anti-SSRF: rechaza IPs privadas/metadata resueltas y nombres internos.
        if (!(await isHostAllowed(parsedTarget.hostname))) {
          res.status(400).json({ success: false, error: 'URL not allowed' });
          return;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const upRes = await fetch(target, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Accept': 'image/*,*/*;q=0.8',
            },
          });
          // Anti-SSRF tras redirects: la URL FINAL (después de follow) también
          // debe apuntar a un host público (un redirect podría caer a IP interna).
          try {
            if (upRes.url && !(await isHostAllowed(new URL(upRes.url).hostname))) {
              clearTimeout(timer);
              try { await upRes.body?.cancel(); } catch {}
              res.status(400).json({ success: false, error: 'URL not allowed' });
              return;
            }
          } catch {
            // upRes.url ilegible → no bloquear (el chequeo inicial ya pasó)
          }
          if (!upRes.ok) {
            clearTimeout(timer);
            res.status(502).json({ success: false, error: `Upstream HTTP ${upRes.status}` });
            return;
          }
          // Tope temprano por content-length (evita bufferizar 2GB para rechazarlo).
          const declared = Number(upRes.headers.get('content-length') || 0);
          if (declared > MAX_IMAGE_PROXY_BYTES) {
            clearTimeout(timer);
            res.status(413).json({ success: false, error: 'Image too large' });
            return;
          }
          // Lectura con CAP: aborta si el stream supera el tope (content-length
          // ausente o mentiroso → no hay OOM del server).
          const reader = upRes.body?.getReader();
          const chunks = [];
          let total = 0;
          let tooLarge = false;
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_IMAGE_PROXY_BYTES) {
                tooLarge = true;
                try { await reader.cancel(); } catch {}
                break;
              }
              chunks.push(value);
            }
          }
          clearTimeout(timer);
          if (tooLarge) {
            res.status(413).json({ success: false, error: 'Image too large' });
            return;
          }
          const buf = Buffer.concat(chunks, total);
          if (buf.length === 0) {
            res.status(502).json({ success: false, error: 'Empty upstream response' });
            return;
          }
          const contentType = upRes.headers.get('content-type') || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.statusCode = 200;
          res.end(buf);
        } catch (err) {
          console.warn('[music-server] image-proxy:', err.message);
          if (!res.headersSent) res.status(502).json({ success: false, error: 'Image proxy error' });
          else res.end();
        }
        return;
      }

      res.status(404).json({
        success: false,
        error: 'Not found. Endpoints: /api/music/health · /api/music/search?q=... · /api/music/stream?artist=&title= · /api/music/download?artist=&title= · /api/music/resolve?artist=&title= · /api/image-proxy?url=',
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
    // ── Diagnóstico de cookies, plugin POT y server POT (bot-check de YouTube) ──
    logCookiesDiagnostics();
    logPotPluginDiagnostics();
    detectLibc();
    checkPotServer();
    // ── Auto-configuración del proxy (detecta el teléfono vía Tailscale) ──
    autoConfigureProxyDiagnostics().finally(() => {
      // ── Diagnóstico del proxy (Termux/Tailscale o residencial) ──
      checkProxyDiagnostics();
    });
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
