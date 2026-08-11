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
import { existsSync, readFileSync, writeFileSync, writeFile, mkdirSync, renameSync, unlinkSync, statSync, readdirSync, appendFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
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

// ── Proxy residencial/ISP (anti bot-check en IPs de datacenter) ──
// HidenCloud asigna IPs de datacenter marcadas por YouTube: "Sign in to confirm
// you're not a bot" (LOGIN_REQUIRED) en TODOS los clients aunque el PO token
// esté generándose — la IP está bloqueada a nivel de red y ningún token la
// salva (yt-dlp FAQ). Con un proxy residencial/ISP la IP de salida parece banda
// ancha normal → el bot-check desaparece.
// ⚠️ CRÍTICO: la URL de googlevideo queda ligada a la IP que la resolvió, así
// que el fetch del media (proxyStream/download) DEBE salir por el MISMO proxy
// (si el media sale por la IP del container → 403). Por eso aquí se configura
// un agente de Node para el media y --proxy para yt-dlp, con la misma URL.
// Configuración: variable de entorno YTDLP_PROXY O archivo proxy.conf en la
// raíz del music-server (útil en hosts donde no se pueden setear env vars,
// como la web console de HidenCloud). Esquema http(s)://user:pass@host:port o
// socks5://user:pass@host:port.
const PROXY_CONF_FILE = join(ROOT_DIR, 'proxy.conf');
function resolveProxyUrl() {
  const fromEnv = process.env.YTDLP_PROXY || '';
  if (fromEnv) return fromEnv;
  try {
    if (existsSync(PROXY_CONF_FILE)) {
      const line = readFileSync(PROXY_CONF_FILE, 'utf8').split(/\r?\n/)[0].trim();
      if (line && !line.startsWith('#')) return line;
    }
  } catch {}
  return '';
}
let YTDLP_PROXY = resolveProxyUrl();
// ffmpeg solo soporta -http_proxy con proxy HTTP PLANO (no https:// ni socks):
// se pasa solo cuando el esquema es http:// (la mayoría de proveedores residenciales).
let YTDLP_PROXY_HTTP = /^http:\/\//i.test(YTDLP_PROXY) ? YTDLP_PROXY : '';
// El agente NO depende del host de destino: depende solo de YTDLP_PROXY. Un único
// singleton evita filtrar un agente + socket pool por cada hostname distinto de
// googlevideo (rr1---sn-..., rr4---sn-... → leak). Se reconstruye en runtime
// cuando autoConfigureProxy detecta el teléfono (applyProxyUrl).
function buildProxyAgent(url) {
  if (!url) return null;
  try {
    if (/^socks(4|4a|5|5h):\/\//i.test(url)) return new SocksProxyAgent(url);
    if (/^https?:\/\//i.test(url)) return new HttpsProxyAgent(url);
    console.warn(`[music-stream] ⚠️ YTDLP_PROXY con esquema no soportado (esperado http:// o socks5://): ${url.slice(0, 40)}…`);
    return null;
  } catch (err) {
    console.warn(`[music-stream] ⚠️ YTDLP_PROXY inválido: ${err.message}`);
    return null;
  }
}
let PROXY_AGENT = buildProxyAgent(YTDLP_PROXY);
// Aplica (o cambia en runtime) la URL del proxy: reconstruye el agente y la
// copia HTTP para ffmpeg. La usa autoConfigureProxy al detectar el teléfono.
function applyProxyUrl(url) {
  YTDLP_PROXY = String(url || '').trim();
  YTDLP_PROXY_HTTP = /^http:\/\//i.test(YTDLP_PROXY) ? YTDLP_PROXY : '';
  PROXY_AGENT = buildProxyAgent(YTDLP_PROXY);
}
function getProxyAgent() {
  return PROXY_AGENT;
}
function getProxyUrl() {
  return YTDLP_PROXY;
}
// ── Auto-detección del teléfono (Termux + Tailscale) ──
// Si el container corre tailscaled (setup-container.sh) y el teléfono está en la
// misma tailnet, se descubre su SOCKS5 SOLO consultando `tailscale status --json`
// — sin editar proxy.conf a mano. music-server.js lo llama al arranque.
function runTailscaleStatusJson() {
  return new Promise((resolve) => {
    // Binarios candidatos: bin/tailscale (instalado por setup-container.sh), env,
    // o PATH. Sockets candidatos: el del daemon userspace (~/.tailscale) y el
    // por defecto. Se prueban hasta que uno responde.
    const candidates = [
      join(localBin, 'tailscale'),
      process.env.TAILSCALE_BIN || '',
      'tailscale',
    ].filter((c) => c && (c === 'tailscale' || existsSync(c)));
    const sockets = [
      ['--socket', join(homedir(), '.tailscale', 'tailscaled.sock'), 'status', '--json'],
      ['status', '--json'],
    ];
    let i = 0;
    const total = candidates.length * sockets.length;
    const attempt = () => {
      if (i >= total) return resolve(null);
      const bin = candidates[Math.floor(i / sockets.length)];
      const args = sockets[i % sockets.length];
      i += 1;
      let out = '';
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; clearTimeout(to); resolve(v); };
      const to = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(null); }, 6000);
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', (d) => { out += d; });
      child.on('close', (code) => { if (code === 0 && out.trim()) done(out.trim()); else attempt(); });
      child.on('error', () => done(null));
    };
    attempt();
  });
}

export async function discoverPhoneProxy() {
  const raw = await runTailscaleStatusJson();
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const selfId = data?.Self?.ID;
  const selfHost = String(data?.Self?.HostName || '').toLowerCase();
  const peers = Object.values(data?.Peer || {}).filter((p) => p && Array.isArray(p.TailscaleIPs));
  const pickIp = (p) => (p.TailscaleIPs || []).find((ip) => /^100\./.test(ip)) || null;
  // 1) Peer cuyo hostname/DNSName contenga termux o phone (el teléfono).
  for (const p of peers) {
    const h = String(p.HostName || p.DNSName || '').toLowerCase();
    if ((h.includes('termux') || h.includes('phone')) && pickIp(p)) return pickIp(p);
  }
  // 2) Cualquier peer que no sea self ni el propio container.
  for (const p of peers) {
    if (p.ID === selfId) continue;
    const h = String(p.HostName || '').toLowerCase();
    if (h === selfHost) continue;
    if (pickIp(p)) return pickIp(p);
  }
  return null;
}

// Auto-configura el proxy si no hay YTDLP_PROXY/proxy.conf válido: detecta el
// teléfono vía la tailnet local y escribe proxy.conf + aplica el agente. Lo
// llama music-server.js al arranque (antes del diagnóstico del proxy) y el
// watchdog. Con { force: true } se RE-DETECTA aunque ya haya proxy configurado
// (IP vieja del teléfono tras dormirse/cambiar) — el watchdog lo usa.
export async function autoConfigureProxy({ force = false } = {}) {
  if (!force && YTDLP_PROXY && PROXY_AGENT) {
    return { configured: true, source: 'configurado (YTDLP_PROXY/proxy.conf)', url: YTDLP_PROXY };
  }
  try {
    const ip = await discoverPhoneProxy();
    if (!ip) return { configured: false, error: 'teléfono no detectado en la tailnet (¿tailscale up en ambos lados?)' };
    const url = `socks5://${ip}:1080`;
    applyProxyUrl(url);
    // Persistir en proxy.conf para futuros arranques (sin daemon tailscale).
    try {
      const existing = readFileSync(PROXY_CONF_FILE, 'utf8').split(/\r?\n/)[0].trim();
      if (existing !== url) writeFileSync(PROXY_CONF_FILE, url + '\n', 'utf8');
    } catch { try { writeFileSync(PROXY_CONF_FILE, url + '\n', 'utf8'); } catch {} }
    console.info(`[music-stream] proxy auto-detectado vía Tailscale: ${url} → YouTube verá IP residencial`);
    return { configured: true, source: 'auto-detectado (Tailscale)', url };
  } catch (err) {
    return { configured: false, error: String(err?.message || err).slice(0, 160) };
  }
}

// Estado del proxy para /api/music/health: permite diagnosticar sin mirar logs
// si el túnel del teléfono (Termux/Tailscale) está vivo y configurado.
export function getProxyStatus() {
  const configured = !!(YTDLP_PROXY && PROXY_AGENT);
  return {
    configured,
    url: configured ? YTDLP_PROXY.replace(/\/\/[^:@]+:[^@]+@/, '//***:***@') : null,
    scheme: YTDLP_PROXY ? YTDLP_PROXY.split(':')[0] : null,
    configFile: existsSync(PROXY_CONF_FILE) ? PROXY_CONF_FILE : null,
  };
}

// Test de conectividad real a través del proxy (sin cookies): verifica que el
// túnel (p. ej. SOCKS5 del teléfono vía Tailscale) está vivo y deja pasar
// tráfico HTTPS. Solo para diagnóstico — nunca bloquea el arranque.
export async function checkProxyReachability({ timeoutMs = 8000 } = {}) {
  if (!YTDLP_PROXY || !PROXY_AGENT) return { configured: false, reachable: false, error: 'no configurado' };
  try {
    const result = await new Promise((resolve) => {
      // Timer independiente como red de seguridad: el timeout del request y el
      // AbortSignal no siempre cortan el connect vía agente SOCKS (verificado:
      // colgaba >30s). El timer RESUELVE la promesa siempre, no deja colgado.
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; resolve(v); };
      const t = setTimeout(() => done({ reachable: false, error: 'timeout' }), timeoutMs);
      const req = https.get('https://www.google.com/generate_204', {
        agent: PROXY_AGENT,
        headers: { 'User-Agent': UA },
      }, (res) => {
        res.resume();
        done({ reachable: res.statusCode === 204 || (res.statusCode >= 200 && res.statusCode < 400), status: res.statusCode });
      });
      req.on('timeout', () => { req.destroy(); done({ reachable: false, error: 'timeout' }); });
      req.on('error', (err) => done({ reachable: false, error: String(err?.code || err?.message || err).slice(0, 120) }));
      // Después de resolver, intentar destruir el socket colgado (best effort).
      t.unref?.();
    });
    return { configured: true, ...result };
  } catch (err) {
    return { configured: true, reachable: false, error: String(err?.message || err).slice(0, 120) };
  }
}
if (YTDLP_PROXY && PROXY_AGENT) {
  console.info(`[music-stream] proxy configurado: ${YTDLP_PROXY.replace(/\/\/[^:@]+:[^@]+@/, '//***:***@')}`);
} else if (YTDLP_PROXY && !PROXY_AGENT) {
  console.warn('[music-stream] ⚠️ YTDLP_PROXY presente pero inválido → se seguirá SIN proxy');
} else if (!process.env.YTDLP_PROXY && existsSync(PROXY_CONF_FILE)) {
  // proxy.conf existe pero sin URL válida (p. ej. se copió proxy.conf.example
  // tal cual y la primera línea es un comentario) → avisar, no fallar en silencio.
  console.warn(`[music-stream] ⚠️ ${PROXY_CONF_FILE} existe pero no contiene una URL de proxy válida en la primera línea`);
  console.warn('   → edítalo con el formato socks5://user:pass@host:port o http://user:pass@host:port (ver proxy.conf.example)');
}

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

// ── Cookies de sesión para el FETCH del media (ANTI-403 transitorio) ──
// googlevideo rechaza con 403 TEMPORAL (anti-abuso, ~30s) las peticiones de
// audio que llegan de una IP justo después de un burst de resolución de yt-dlp
// (pasa en el PRIMER play de una canción sin cache). El fetch del media manda
// las cookies de la sesión logueada → la petición se ve autenticada y esquiva
// el anti-abuso. Se parsea el mismo cookies.txt que usa yt-dlp (formato
// Netscape: dominio \t subdominios \t path \t secure \t expiry \t nombre \t valor).
function buildCookieHeader(cookiesFile) {
  try {
    if (!cookiesFile || !existsSync(cookiesFile)) return null;
    // ⚠️ CRÍTICO: el cookies.txt exportado con la extensión "Get cookies.txt
    // LOCALLY" incluye TODAS las cookies del navegador (vercel_session_id,
    // curr-account, _GRECAPTCHA… → 900+ pares, ~150KB). Mandar ese header al
    // fetch del media hace que googlevideo responda HTTP 400 Bad Request
    // (límite de header ~8KB). Solo se envía el subconjunto de AUTENTICACIÓN
    // de YouTube/Google (SID, LOGIN_INFO…) — suficiente para esquivar el 403
    // transitorio y el anti-bot, y cabe en ~1KB.
    const AUTH_COOKIES = new Set([
      'SID', '__Secure-3PSID', '__Secure-1PSID', '__Secure-3PAPISID', '__Secure-1PAPISID',
      'HSID', 'SSID', 'APISID', 'SAPISID', 'LOGIN_INFO',
      'SIDCC', '__Secure-3PSIDCC', '__Secure-1PSIDCC',
      '__Secure-1PSIDTS', '__Secure-3PSIDTS',
      'PREF', 'VISITOR_INFO1_LIVE', 'CONSENT', 'YSC', 'OTZ',
    ]);
    const seen = new Set();
    const pairs = [];
    for (const raw of readFileSync(cookiesFile, 'utf8').split('\n')) {
      let line = raw.trim();
      if (!line) continue;
      // El prefijo #HttpOnly_ (curl y la mayoría de exportadores) NO es un
      // comentario: son las cookies HttpOnly (SID, HSID, LOGIN_INFO…), las
      // críticas para autenticar el fetch. Sin esto se perdían y el 403
      // transitorio no se esquivaba.
      if (line.startsWith('#HttpOnly_')) line = line.slice('#HttpOnly_'.length).trimStart();
      else if (line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length < 7) continue;
      const name = parts[5]?.trim();
      const value = parts[6]?.trim();
      // Solo cookies de auth de YouTube/Google, UNA por nombre (el cookies.txt
      // exportado repite SID/OTZ/… por cada dominio — dedupe para header mínimo).
      if (name && value && AUTH_COOKIES.has(name) && !seen.has(name)) {
        seen.add(name);
        pairs.push(`${name}=${value}`);
      }
    }
    if (!pairs.length) return null;
    let header = pairs.join('; ');
    // Tope duro de seguridad: nunca mandar más de ~6KB (límite googlevideo ~8KB).
    // Se corta en el último par completo (nunca partir una cookie a la mitad:
    // un header malformado también provocaría 400).
    while (Buffer.byteLength(header) > 6000) {
      const cut = header.lastIndexOf('; ', 6000);
      if (cut <= 0) break;
      header = header.slice(0, cut);
    }
    return header;
  } catch {
    return null;
  }
}
// Header de cookies del fetch del media, con RECARGA DINÁMICA: la sesión de
// YouTube se revoca rápido (el usuario reexporta cookies.txt y lo sube al
// container SIN reiniciar). El header se re-lee si el archivo cambió (mtime)
// en cada fetch — así nunca se usa una sesión revocada para el media.
let cookieHeaderCache = buildCookieHeader(YTDLP_COOKIES_FILE);
let cookieHeaderMtime = 0;
function getCookieHeader() {
  try {
    if (YTDLP_COOKIES_FILE && existsSync(YTDLP_COOKIES_FILE)) {
      const m = statSync(YTDLP_COOKIES_FILE).mtimeMs;
      if (m !== cookieHeaderMtime) {
        cookieHeaderMtime = m;
        const rebuilt = buildCookieHeader(YTDLP_COOKIES_FILE);
        if (rebuilt && rebuilt !== cookieHeaderCache) {
          cookieHeaderCache = rebuilt;
          console.info(`[music-stream] cookies de sesión recargadas (${rebuilt.split(';').length} pares auth)`);
        }
      }
    }
  } catch {}
  return cookieHeaderCache;
}
if (cookieHeaderCache) {
  console.info(`[music-stream] cookies de sesión cargadas para el fetch del media (${cookieHeaderCache.split(';').length} pares auth)`);
} else {
  console.warn('[music-stream] ⚠️ sin cookies de auth para el fetch del media → el primer play puede fallar con 403 transitorio');
}

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
  // ⚠️ Verificado empíricamente con yt-dlp 2026.07.04 + binario bgutil-pot 0.8.1:
  //   - web (WEBPO) es el ÚNICO de la cadena que solicita PO tokens: con
  //     youtube:fetch_pot=always genera el token (provider bgutil:cli, sin
  //     server HTTP) y resuelve URL directa itag=140 en IPs de datacenter. En
  //     IPs limpias también funciona (audio puro con URL directa).
  //   - tv_embedded NO existe en INNERTUBE_CLIENTS de yt-dlp 2026.07.04: se
  //     salta con "Skipping unsupported client" y cae a android_vr/web_safari
  //     (que NO piden token → LOGIN_REQUIRED en IP de datacenter).
  //   - mediaconnect con player_skip fue la ruta clásica (IPs limpias) pero en
  //     IPs de datacenter marcadas recibe "Sign in to confirm you're not a bot".
  //   - android/tv: URLs directas pero NO piden PO token (no están en
  //     WEBPO_CLIENTS) → fallan en IP de datacenter. Se conservan como fallback
  //     para IPs limpias y videos DRM-ish.
  const base = [
    // mweb: WEBPO + fetch_pot=always → token vía bgutil → esquiva bot-check.
    // Verificado empíricamente con youtube:client=mweb + fetch_pot=always +
    // cookies: token generado + URL itag=140 resuelta (IP limpia).
    'youtube:player_client=mweb',
    // web: WEBPO, mismo mecanismo de token que mweb.
    'youtube:player_client=web',
    // mediaconnect: ruta clásica rápida (IPs limpias)
    'youtube:player_client=mediaconnect;player_skip=webpage,configs',
    // android: URLs directas (a veces video+audio combinado)
    'youtube:player_client=android',
    // tv: último recurso (algunos videos son DRM)
    'youtube:player_client=tv',
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
    // PO Token providers — DOBLE vía, verificado empíricamente con v0.8.1:
    //   - bgutil:cli (SIN server): genera el token POR PETICIÓN invocando el
    //     binario (--content-binding). Robusto aunque el server HTTP esté
    //     caído: HidenCloud mata el server cada ~20-40s con SIGKILL silencioso
    //     (el log de bgutil-pot se corta en seco sin error) y el modo script no
    //     deja ningún proceso vivo que matar. Este es el provider de RESERVA.
    //   - bgutil:http: rápido si el server responde (tokens cacheados).
    // yt-dlp usa http primero y cae a cli automáticamente si no responde.
    const potBin = join(localBin, 'bgutil-pot');
    if (existsSync(potBin)) {
      // El provider CLI (yt-dlp) invoca el binario por petición: sin el bit +x
      // (se pierde al copiar la carpeta por panel) el spawn falla con EACCES.
      try { chmodSync(potBin, 0o755); } catch {}
      baseArgs.push('--extractor-args', `youtubepot-bgutilcli:cli_path=${potBin}`);
    }
    // PO Token server URL (si está configurado)
    if (process.env.BGUTIL_POT_BASE_URL) {
      baseArgs.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${process.env.BGUTIL_POT_BASE_URL}`);
    }
    // youtube:fetch_pot=always — CRÍTICO para IPs de datacenter. Por defecto
    // (auto) yt-dlp solo pide el token tras un fallo del player, y ese reintento
    // no se dispara para los clients no-WEBPO (android/tv) ni tras el skip de
    // tv_embedded → LOGIN_REQUIRED → bot-check. Forzando la petición SIEMPRE,
    // el client web genera el token por adelantado (provider bgutil:cli) y la
    // resolución pasa aunque la IP esté marcada. Verificado localmente: token
    // generado + URL itag=140 resuelta sin server HTTP.
    baseArgs.push('--extractor-args', 'youtube:fetch_pot=always');
    // Proxy residencial/ISP: TODAS las llamadas de yt-dlp (resolve + search)
    // salen por él → la IP que ve YouTube es residencial → sin bot-check.
    if (YTDLP_PROXY) baseArgs.push('--proxy', YTDLP_PROXY);
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
      else {
        // ⚠️ El error REAL va al FINAL del verbose (el inicio es el Command-line
        // config, que antes ocultaba la causa). Se extraen las líneas
        // significativas (ERROR/Sign in/403/playability/…[pot]) y si no hay, la
        // cola. Además se adjunta el stderr COMPLETO al error (err.stderr) para
        // que el diagnóstico pueda volcarlo aunque el intento FALLE.
        const lines = stderr.split('\n').filter(Boolean);
        const interesting = lines.filter((l) => /ERROR|WARNING|Sign in|Requested format|not available|playability|HTTP \d{3}|\[pot/i.test(l)).slice(-4).join(' | ');
        const fallback = lines.slice(-3).join(' | ');
        const e = new Error(`yt-dlp exit ${code}: ${(interesting || fallback).slice(0, 600)}`);
        e.stderr = stderr;
        e.stdout = stdout;
        finish(reject, e);
      }
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
// Una URL es válida si new URL() la parsea y tiene host. Se usa para
// descartar lo que yt-dlp imprima que empiece por https:// pero NO sea una
// URL real (p. ej. líneas de manifest parciales, o salida con BOM/\r).
function isValidStreamUrl(url) {
  try {
    const u = new URL(url);
    return !!u.hostname;
  } catch { return false; }
}

// ── Asegurar el server POT antes de resolver ──
// El bot-check en IP de datacenter solo se esquiva si el server bgutil-pot
// responde (sin él el plugin no puede generar el token). Este server tiende a
// caerse en el container → se relanza aquí mismo si el ping falla y se espera
// a que responda (mismo patrón detached + log + pid file que music-server.js).
function potPing(base, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(`${base}/ping`, { signal: controller.signal })
      .then(async (res) => ({ ok: res.ok, version: res.ok ? ((await res.json().catch(() => ({}))).version || '') : '' }))
      .catch((err) => ({ ok: false, version: '', err: err.cause?.code || err.message }))
      .finally(() => clearTimeout(t));
  } catch { return Promise.resolve({ ok: false, version: '' }); }
}

// Warm-up REAL: POST /get_pot genera un token de prueba. El ping solo engaña:
// el server relanzado responde al ping antes de estar listo para GENERAR
// tokens (o HidenCloud lo mata justo después) — verificado en producción: el
// log mostraba providers registrados pero SIN "Generating a gvs PO Token" →
// LOGIN_REQUIRED en todos los clients. El POST confirma que sirve tokens de
// verdad. (Endpoint verificado: POST {content_binding} → 200 {poToken,...}
// en ~700ms; el token queda cacheado por content_binding en el server.)
async function potWarmup(base, timeoutMs = 10000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${base}/get_pot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_binding: 'dQw4w9WgXcQ' }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return !!(j && j.poToken);
  } catch {
    return false;
  }
}

// Momento del último relanzamiento del server POT (0 = nunca relanzado en esta
// sesión). resolveStream lo usa para reintentar el resolve cuando un bot-check
// ocurre justo tras el relanzamiento: el ping ya responde ('up') pero el server
// aún no genera tokens.
let potLastStartedAt = 0;
// Lock: dos resolves concurrentes podrían relanzar el server a la vez (uno gana
// el puerto 4416, el otro falla con EADDRINUSE). El segundo espera al primero.
let potLaunching = null;

// Mata el proceso POT anterior si sigue vivo: el caso "vivo pero roto" (responde
// ping pero no sirve tokens — el estado exacto de producción) ocupa el puerto y
// el spawn nuevo fallaría con EADDRINUSE. Se usa el pid file compartido con
// music-server.js.
function killPotProcess() {
  try {
    const pidFile = join(localBin, '.bgutil-pot.pid');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (pid > 0) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
      try { unlinkSync(pidFile); } catch {}
    }
  } catch {}
}

async function ensurePotServerUp({ maxWaitMs = 15000 } = {}) {
  const base = process.env.BGUTIL_POT_BASE_URL;
  if (!base) return 'n/a';
  // Sano = responde al ping Y genera un token de prueba (el ping solo engaña).
  const healthy = async () => (await potPing(base)).ok && (await potWarmup(base));
  if (await healthy()) return 'up';
  const bin = join(localBin, 'bgutil-pot');
  if (!existsSync(bin)) return 'failed';
  // Auto-reparar el bit +x (la subida por panel lo quita → spawn EACCES).
  try { chmodSync(bin, 0o755); } catch {}
  // Otro resolve ya está relanzando: esperar y re-evaluar (el server del
  // ganador servirá para ambos).
  if (potLaunching) {
    try { await potLaunching; } catch {}
    return (await healthy()) ? 'up' : 'failed';
  }
  console.warn('[music-stream] PO Token server caído o sin servir tokens → lanzándolo antes de resolver...');
  potLaunching = (async () => {
    // El proceso anterior puede seguir vivo pero roto ocupando el puerto.
    killPotProcess();
    await sleep(500);
    try {
      const child = spawn(bin, ['server', '--port', '4416', '--verbose'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      child.unref();
      const logFile = join(localBin, 'bgutil-pot.log');
      // Rotar si crece (mismo criterio que music-server.js) — --verbose escribe por request.
      try { if (statSync(logFile).size > 1_000_000) writeFileSync(logFile, ''); } catch {}
      child.stdout?.on('data', (d) => { try { appendFileSync(logFile, d); } catch {} });
      child.stderr?.on('data', (d) => { try { appendFileSync(logFile, d); } catch {} });
      // Limpiar el pid file solo si sigue apuntando a ESTE proceso (race con
      // music-server.js, que comparte el mismo archivo para su auto-reparación).
      child.on('exit', () => {
        try {
          if (Number(readFileSync(join(localBin, '.bgutil-pot.pid'), 'utf8')) === child.pid) unlinkSync(join(localBin, '.bgutil-pot.pid'));
        } catch {}
      });
      try { writeFileSync(join(localBin, '.bgutil-pot.pid'), String(child.pid), 'utf8'); } catch {}
    } catch (err) {
      console.warn('[music-stream] ⚠️ no se pudo lanzar el POT server:', err.message);
    }
  })();
  try { await potLaunching; } finally { potLaunching = null; }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await healthy()) {
      potLastStartedAt = Date.now();
      return 'started';
    }
    await sleep(1000);
  }
  console.warn('[music-stream] ⚠️ POT server no sirve tokens tras relanzarlo');
  return 'failed';
}

export async function resolveBestAudioUrl(videoUrl) {
  // Selector ULTRA-permisivo: intenta todo, incluyendo video+audio
  const run = (extra, opts = {}) => runYtDlp([
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/bestvideo[ext=m4a]+bestaudio/best',
    '--get-url', '--no-playlist',
    ...extra, videoUrl,
  ], opts);
  const parseUrl = (stdout) => {
    // Normalizar línea a línea: quitar BOM, \r, y espacios. Solo se acepta si
    // new URL() la parsea — así nunca cacheamos basura que luego rompa el stream.
    for (const raw of stdout.split('\n')) {
      const l = raw.replace(/^\uFEFF/, '').replace(/\r$/, '').trim();
      if (/^https?:\/\//.test(l) && isValidStreamUrl(l)) return l;
    }
    return null;
  };

  // El bot-check en IP de datacenter necesita el server POT vivo: si está
  // caído, relanzarlo ANTES de intentar los clients (si no, es bot-check seguro).
  if (process.env.BGUTIL_POT_BASE_URL) {
    const st = await ensurePotServerUp();
    if (st === 'failed') console.warn('[music-stream] ⚠️ POT server no disponible → el bot-check puede fallar');
  }

  // Intentar con cookies (si disponibles) — primer intento verbose para diagnosticar.
  // ⚠️ El volcado y el estado del provider se llaman TAMBIÉN en el fallo
  // (err.stderr): en producción todos los clients salen con exit 1 y el bloque
  // del try (post-await) solo se ejecuta cuando yt-dlp sale con exit 0 — sin
  // esto el diagnóstico nunca llegaría al caso que nos interesa.
  let isFirstAttempt = true;
  const logFirstAttempt = (stderr) => {
    if (!stderr) return;
    // Volcado COMPLETO del verbose del primer client a .ytdlp-debug.log:
    // ahí se ve la causa real sin truncar (bot-check, provider POT cargado o
    // "none", formato no disponible, 403…). Se sobreescribe en cada resolve.
    try { writeFileSync(join(ROOT_DIR, '.ytdlp-debug.log'), stderr, 'utf8'); } catch {}
    // Estado del PO Token provider (plugin bgutil) + intentos de generación.
    // Solo prefijos [pot]... (nunca el cuerpo de un token si se activara trace logging)
    const potLines = stderr.split('\n').filter(l => /\[pot\]|\[pot:/i.test(l));
    if (potLines.length) console.info('[music-stream] PO Token info:', potLines.slice(0, 8).join(' | '));
    // ¿El plugin está REGISTRADO como provider? ("bgutil:http-0.8.1 (external)"
    // vs "none") — la diferencia es el bot-check que sí se puede esquivar.
    const provLine = stderr.split('\n').find((l) => /PO Token Providers/i.test(l));
    if (provLine) console.info('[music-stream] POT providers:', provLine.replace(/^\[debug\]\s*\[youtube\]\s*/i, '').trim());
  };
  // Prueba la cadena de clients (con o sin cookies). Devuelve la URL o lanza el
  // último error. El paso "sin cookies" reintenta con la MISMA cadena (antes
  // usaba los clients por defecto de yt-dlp → SABR → nunca daba URL): sirve
  // para el caso "la cuenta está marcada pero la ruta anónima + PO token pasa".
  const tryClients = async ({ skipCookies }) => {
    let lastErr = null;
    for (const client of YTDLP_CLIENTS) {
      const clientName = client.replace('youtube:player_client=', '').replace(/;.*/, '');
      try {
        const { stdout, stderr } = await run(['--extractor-args', client], {
          // Primer intento (client web, verbose para diagnóstico): timeout 30s —
          // en cache-miss si web falla transitoriamente ("Only images"), no
          // quemar 45s antes de caer al siguiente client. Los resolves reales
          // tardan 5-25s (token vía bgutil:cli incluido).
          ...(isFirstAttempt ? { verbose: true, timeoutMs: 30000 } : {}),
          skipCookies,
        });
        if (isFirstAttempt && stderr) logFirstAttempt(stderr);
        isFirstAttempt = false;
        const line = parseUrl(stdout);
        if (line) {
          console.info(`[music-stream] resuelto con client: ${clientName}${skipCookies ? ' (sin cookies)' : ''}`);
          return line;
        }
        // El client respondió pero sin URL → loguear la razón real (p. ej. playability)
        const errLine = (stderr.split('\n').find(l => /ERROR:|WARNING:/i.test(l)) || '').trim().slice(0, 220);
        console.warn(`[music-stream] client ${clientName}: sin URL de audio${errLine ? ` — ${errLine}` : ''}`);
      } catch (err) {
        if (isFirstAttempt && err?.stderr) logFirstAttempt(err.stderr);
        isFirstAttempt = false;
        // El error REAL de cada client (bot-check, provider POT caído, 403, timeout…)
        const reason = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 700);
        console.warn(`[music-stream] client ${clientName} falló: ${reason}`);
        lastErr = err;
      }
    }
    throw lastErr || new Error('No audio URL resolved');
  };

  // 1) Con cookies.
  try {
    return await tryClients({ skipCookies: false });
  } catch (err) {
    // 2) Sin cookies SOLO si el fallo huele a bot-check (cuenta/IP marcada): así no
    //    se duplica la latencia en fallos por timeout/403, que no se arreglarían
    //    quitando cookies.
    if (YTDLP_COOKIES_FILE && /Sign in to confirm|confirm you're not a bot|not a bot/i.test(String(err.message || ''))) {
      console.warn('[music-stream] intentando sin cookies...');
      try {
        return await tryClients({ skipCookies: true });
      } catch {}
    }
    // Bot-check de YouTube: con --cookies presente suele ser cookies inválidas/
    // expiradas o SIN las de autenticación (SID/LOGIN_INFO), o IP de datacenter
    // sin PO token activo (el log de arranque lo indica: "PO Token plugin").
    if (err && /Sign in to confirm|confirm you're not a bot|not a bot/i.test(String(err.message || ''))) {
      throw new Error('YouTube pide login (bot check): con --cookies presente suele ser cookies inválidas/expiradas o sin las de autenticación (SID/LOGIN_INFO — exporta con HttpOnly), o IP de datacenter sin PO token activo (revisa el log de arranque "PO Token plugin").');
    }
    throw err;
  }
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

// Invalida la entrada de caché de una canción (URL poisoned tras un 403 del
// media). Se exporta para que handleStreamRequest la conecte a la cadena de
// reintentos: si la URL cacheada da 403, se borra para que la siguiente
// request no la reutilice y re-resuelva con token fresco. NO se toca
// inflightStream: sus entradas son transitorias (se limpian al resolver) y
// borrarlas abriría una ventana de resolución duplicada para requests
// concurrentes.
export function invalidateStreamCache(artist, title) {
  const query = [String(artist || '').trim(), String(title || '').trim()].filter(Boolean).join(' - ') || String(title || '');
  streamCache.delete(query.toLowerCase());
}

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
    const resolveAndCache = async () => {
      const url = await resolveBestAudioUrl(best.url);
      if (!isValidStreamUrl(url)) {
        console.warn(`[music-stream] ⚠️ URL no parseable para "${query}": ${JSON.stringify(String(url).slice(0, 150))}`);
        throw new Error('Invalid stream URL');
      }
      const mime = getMimeFromUrl(url);
      streamCache.set(key, { url, mime, at: Date.now(), __v: CACHE_VERSION, videoTitle: best.title, videoId: best.id });
      persistCache();
      return { url, mime, videoTitle: best.title, videoId: best.id };
    };
    try {
      return await resolveAndCache();
    } catch (err) {
      // Bot-check: sin token el resolve no puede pasar. Se asegura el server POT
      // y se reintenta UNA vez si el server acaba de ser relanzado (potLastStartedAt
      // reciente): el relanzado responde al ping pero puede no estar listo para
      // generar tokens en el primer intento — verificado en producción (log con
      // providers registrados pero SIN "Generating" → LOGIN_REQUIRED en todos
      // los clients). Si el server estaba estable y el token fue rechazado, el
      // reintento no ayuda — no se insiste más.
      if (/bot check|pide login|Sign in to confirm/i.test(String(err.message || ''))) {
        const st = await ensurePotServerUp();
        if (st === 'started' || (potLastStartedAt > 0 && Date.now() - potLastStartedAt < 20000)) {
          console.warn('[music-stream] ↻ reintentando resolución con POT server activo...');
          return await resolveAndCache();
        }
      }
      throw err;
    }
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

// ── Respuestas JSON sin depender del shim Express-lite de music-server.js ──
// El ServerResponse nativo de Node NO tiene .status()/.json() (son de Express).
// music-server.js los inyecta en cada request (adapt()), pero estos handlers
// usan la API nativa para funcionar en cualquier contexto (test, reutilización).
function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

// ── Cadena de reintentos resiliente (proxy y download) ──
// googlevideo responde 403 en DOS casos distintos, que el flujo distingue por
// resultado:
//   A) URL POISONED (la dominante): la URL cacheada fue resuelta con un token
//      POT inválido (p. ej. el primer token generado tras relanzar el server
//      bgutil-pot) → 403 PERMANENTE aunque pase el cooldown. La única salida
//      es RE-resolver con token nuevo, que funciona al instante (verificado en
//      producción: URL cacheada 403 durante 51s → fresh resolve → 200 en 0.5s).
//   B) Cooldown de IP (~30s anti-abuso por burst de resolución): afecta a
//      TODAS las URLs mientras dura, incluidas las re-resueltas.
// Estrategia:
//   1. URL actual (cache hit fuera de cooldown → instantáneo).
//   2. Misma URL tras 1s (throttling puntual / blip).
//   3. Invalidar caché + resolución fresca INMEDIATA (arregla A en ~15s).
//   4. Si el fresh también falla → cooldown de IP (B): esperar
//      RETRY_BACKOFF_LONG_MS y reintentar con la misma URL fresca.
//   5. Último recurso: resolución fresca de nuevo.
// ── Diagnóstico de errores de red ──
// Los errores de socket de Node (especialmente tras reinicios del container o
// en Node 26) pueden llegar con message VACÍO → el log quedaba ciego
// ("✗ canción · "). describeErr() siempre produce un mensaje accionable y
// logErrDetail() imprime code/errno/syscall + stack la primera vez que aparece
// cada error.
const errDetailLogged = new Set();
function describeErr(err) {
  if (!err) return '(sin error)';
  const parts = [];
  if (err.message) parts.push(String(err.message));
  if (err.code) parts.push(`code=${err.code}`);
  if (err.errno) parts.push(`errno=${err.errno}`);
  if (err.syscall) parts.push(`syscall=${err.syscall}`);
  // AggregateError (p. ej. connect Happy Eyeballs de Node): listar cada
  // dirección que falló para distinguir IPv4 vs IPv6 vs red del container.
  if (Array.isArray(err.errors) && err.errors.length) {
    const ips = err.errors.slice(0, 6).map((e) => e.address || e.host || e.message || String(e));
    if (ips.length) parts.push(`ips=[${ips.join(', ')}]`);
  }
  return parts.join(' · ') || '(error sin detalles)';
}
function isConnError(err) {
  if (!err) return false;
  if (!err.message) return true; // error vacío = nivel socket
  const c = String(err.code || '').toUpperCase();
  return ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO', 'ECONNABORTED', 'ERR_SOCKET_CLOSED'].includes(c)
    || /socket hang up|aborted|premature close/i.test(String(err.message));
}
function logErrDetail(tag, err) {
  const key = `${tag}|${err?.code || err?.message || '?'}`;
  if (errDetailLogged.has(key)) return;
  errDetailLogged.add(key);
  const stack = err?.stack ? `\n${String(err.stack).split('\n').slice(0, 5).join('\n')}` : '';
  console.warn(`[music-stream] 🐞 ${tag} → ${describeErr(err)}${stack}`);
}

async function attemptStreamWithRetries({ label, url, doStream, refresh, res, onPoisoned } = {}) {
  let lastErr = null;
  let connHintShown = false;
  const guard = (err) => {
    lastErr = err;
    console.warn(`[music-stream] ✗ ${label} · ${describeErr(err)}`);
    logErrDetail(label, err);
    // Error de CONEXIÓN (ETIMEDOUT/ECONNRESET/…) → no es cooldown HTTP: la IP
    // del container está bloqueada a nivel TCP por el CDN. Pista accionable UNA
    // vez por request.
    if (isConnError(err) && !connHintShown) {
      connHintShown = true;
      console.warn(`[music-stream] ⚠️ error de CONEXIÓN a googlevideo (${describeErr(err)}) → la IP del container parece bloqueada a nivel TCP por el CDN. Reinicia/recrea el container para renovar la IP, o configura YTDLP_PROXY (proxy residencial/ISP) — resolve y media saldrán por otra IP y el bloqueo/bot-check desaparecen.`);
    }
    if (res.headersSent || res.destroyed) throw err;
  };
  // 1) URL actual. Con cookies y cache hit fuera del cooldown → al instante.
  try {
    await doStream(url);
    return;
  } catch (err) { guard(err); }
  // 2) Misma URL tras 1s — SOLO si el fallo fue HTTP (403 transitorio / blip
  //    puntual). Si fue error de CONEXIÓN (ETIMEDOUT…) la IP está bloqueada a
  //    nivel TCP: reintentar la MISMA URL es perder 10-30s en un intento que
  //    no puede ganar (verificado en producción: 5 ETIMEDOUT seguidos con la
  //    misma IP hasta que el cooldown expiró). Se salta directo al fresh.
  if (!isConnError(lastErr)) {
    await sleep(1000);
    try {
      console.warn(`[music-stream] ↻ ${label} · reintento (backoff)...`);
      await doStream(url);
      return;
    } catch (err) { guard(err); }
  } else {
    console.warn(`[music-stream] ↻ ${label} · error de conexión → salto a resolución fresca (la misma URL no se re-intenta)`);
  }
  // 3) Tras fallar la URL actual (poisoned o IP en cooldown) se invalida la
  //    caché y se re-resuelve. En el caso 403-poisoned la URL fresca con token
  //    nuevo funciona al instante (verificado en producción). En el caso de
  //    cooldown de IP la URL fresca puede fallar igual → cae al paso 4.
  try { onPoisoned?.(); } catch {}
  let freshUrl = null;
  try {
    const fresh = await refresh();
    freshUrl = fresh?.url || null;
    if (!freshUrl) throw new Error('No stream found after retries');
    console.warn(`[music-stream] ↻ ${label} · reintentando con resolución fresca...`);
    await doStream(freshUrl);
    return;
  } catch (err) { guard(err); }
  // 4) El fresh también falló → cooldown de googlevideo (~30s) que afecta a
  //    TODAS las URLs mientras dura. SIEMPRE se espera el backoff antes del
  //    siguiente intento (también con errores de conexión: es el tiempo que
  //    tarda en expirar el bloqueo TCP de la IP — sin esta espera el intento
  //    cae inevitablemente en el mismo ETIMEDOUT).
  await sleep(RETRY_BACKOFF_LONG_MS);
  try {
    if (freshUrl) {
      console.warn(`[music-stream] ↻ ${label} · reintento (backoff largo, cooldown googlevideo)...`);
      await doStream(freshUrl);
      return;
    }
  } catch (err) { guard(err); }
  // 5) Último recurso: resolución fresca de nuevo tras esperar el cooldown.
  await sleep(2000);
  try {
    const fresh2 = await refresh();
    if (!fresh2?.url) throw new Error('No stream found after retries');
    console.warn(`[music-stream] ↻ ${label} · reintentando con resolución fresca (último)...`);
    // Respiro corto: el fresh resolve es un nuevo burst que puede rearmar el
    // cooldown — un hedge de 3s antes del fetch final.
    await sleep(3000);
    await doStream(fresh2.url);
  } catch (err) { guard(err); throw err; }
}

// ── Fallback de proxy vía undici (fetch nativo) ──
// El http/https.request de Node puede fallar a nivel de SOCKET con errores de
// message vacío (p. ej. tras reinicios del container, sockets keep-alive
// envenenados del agente global, o cambios en Node 26). fetch (undici) usa una
// pila de red totalmente distinta → suele pasar donde request falla. Devuelve
// errores NUNCA vacíos (message + code + causa) para diagnóstico.
async function proxyViaFetch(req, res, url, label = 'fetch') {
  const target = withRateBypass(url);
  const headers = { 'User-Agent': UA, 'Accept': '*/*' };
  const cookieHeader = getCookieHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (req.headers.range) headers.Range = req.headers.range;
  let upRes;
  try {
    upRes = await fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  } catch (err) {
    throw new Error(`fetch: ${describeErr(err?.cause || err)}`, { cause: err });
  }
  if (!upRes.ok) {
    upRes.body?.cancel?.().catch?.(() => {});
    throw new Error(`download HTTP ${upRes.status}`);
  }
  res.statusCode = upRes.status || 200;
  const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'];
  for (const h of pass) {
    const v = upRes.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  const total = (() => {
    const cl = Number(upRes.headers.get('content-length'));
    const cr = String(upRes.headers.get('content-range') || '').match(/\/(\d+)$/);
    return cr ? Number(cr[1]) : (Number.isFinite(cl) ? cl : null);
  })();
  const progress = progressLogger({ label, total, startedAt: Date.now() });
  const reader = upRes.body.getReader();
  let finished = false;
  const firstByteTimer = setTimeout(() => { reader.cancel().catch(() => {}); }, FIRST_BYTE_TIMEOUT_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(firstByteTimer);
      progress.add(value.byteLength);
      if (res.destroyed || res.writableEnded) { reader.cancel().catch(() => {}); progress.abort(); return; }
      if (res.write(Buffer.from(value)) === false && !res.destroyed) {
        // Backpressure: esperar 'drain' SIN colgarse — si el cliente se
        // desconecta a mitad, 'drain' jamás llega (un stream destruido no lo
        // emite); se compite con 'close'/'error' para salir siempre.
        await new Promise((r) => {
          const done = () => r();
          res.once('drain', done);
          res.once('close', done);
          res.once('error', done);
        });
      }
    }
    clearTimeout(firstByteTimer);
    finished = true;
    progress.finish();
    if (!res.writableEnded) res.end();
  } catch (err) {
    clearTimeout(firstByteTimer);
    if (!finished) {
      progress.abort();
      throw new Error(describeErr(err), { cause: err });
    }
  }
}

// ── Handler /api/music/stream ──
// STREAM EN VIVO (proxy real): pipea googlevideo → cliente byte a byte con el
// PRIMER byte al instante. NO bufferiza la canción completa (que con el
// throttling de googlevideo tardaba 90-170s en llegar). Mantiene la cadena de
// reintentos: misma URL con backoff corto → backoff largo (cooldown 403) →
// resolución fresca (URL caducada/403/0 bytes). /api/music/download conserva
// el pipeline cacheado (memoria/disco) para re-producciones instantáneas.
export async function handleStreamRequest(req, res, { artist = '', title = '', duration = 0, fresh = false } = {}) {
  const startedAt = Date.now();
  const label = `${artist} - ${title}`.trim() || 'stream';
  try {
    const resolved = await resolveStream({ artist, title, duration }, { fresh });
    if (!resolved?.url) { sendJson(res, 404, { success: false, error: 'No stream found' }); return; }
    const resolveSecs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const playable = isBrowserPlayableMime(resolved.mime);
    console.info(`[music-stream] ▶ ${label} · resolución ${resolveSecs}s · ${resolved.mime || 'mime?'} · ${playable ? 'proxy' : 'transcode'}`);

    // El fallback undici SOLO se intenta una vez por request: si el error de
    // conexión es sistémico (IP bloqueada, egress del container), reintentarlo
    // en cada uno de los 5 intentos serían 10 tries de red por play inútil.
    let fetchFallbackTried = false;
    const doStream = (url) => {
      if (!playable) return transcodeStream(req, res, url, label);
      // Fallback vía undici (fetch): si el error es de CONEXIÓN (ECONNRESET,
      // socket hang up, message vacío en Node 26...) se reintenta por una ruta
      // de sockets totalmente distinta antes de tirar el intento.
      return proxyStream(req, res, url, label).catch((err) => {
        if (!isConnError(err) || fetchFallbackTried) throw err;
        fetchFallbackTried = true;
        logErrDetail(`${label} → fallback undici`, err);
        return proxyViaFetch(req, res, url, label);
      });
    };

    await attemptStreamWithRetries({
      label,
      url: resolved.url,
      doStream,
      res,
      refresh: () => resolveStream({ artist, title, duration }, { fresh: true }),
      // La URL cacheada que dio 403 queda fuera de la caché al instante.
      onPoisoned: () => invalidateStreamCache(artist, title),
    });
    console.info(`[music-stream] ▶ ${label} · stream en vivo completo · ${((Date.now() - startedAt) / 1000).toFixed(1)}s (resolve ${resolveSecs}s)`);
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, describeErr(err));
    if (!res.headersSent && !res.destroyed) sendJson(res, 502, { success: false, error: describeErr(err) });
    else if (!res.writableEnded) res.end();
  }
}

// ── Proxy en vivo (googlevideo → cliente) ──
// Devuelve una promesa que resuelve al terminar el stream o RECHAZA si el
// upstream rechaza (403/404) o muere ANTES de mandar datos → el handler
// reintenta con backoff y resolución fresca.
export function proxyStream(req, res, url, label = 'proxy') {
  return new Promise((resolve, reject) => {
    const target = withRateBypass(url);
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      sendJson(res, 400, { success: false, error: 'Invalid stream URL' });
      reject(new Error('Invalid stream URL'));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': UA };
    // Cookies de sesión (recargadas si cookies.txt cambió): el fetch autenticado
    // esquiva el 403 transitorio de googlevideo (anti-abuso por burst).
    const cookieHeader = getCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (req.headers.range) headers.Range = req.headers.range;
    let firstByteTimer = null;
    // La URL de googlevideo está ligada a la IP que la resolvió: si el resolve
    // usó proxy residencial, el media DEBE salir por el mismo proxy (si no → 403).
    const agent = getProxyAgent();
    // agent: false → conexión FRESCA por intento (el agente global reutiliza
    // sockets keep-alive que tras reinicios del container / en Node 26 pueden
    // llegar envenenados y fallar con errores de conexión de message vacío).
    const proxyReq = lib.request(parsed, { method: 'GET', headers, agent: agent || false }, (upRes) => {
      // Upstream rechaza (403/404) ANTES de mandar datos → reintentar.
      if (upRes.statusCode < 200 || upRes.statusCode >= 300) {
        clearTimeout(firstByteTimer);
        upRes.resume();
        reject(new Error(`download HTTP ${upRes.statusCode}`));
        return;
      }
      res.statusCode = upRes.statusCode || 200;
      ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'].forEach((h) => {
        const v = upRes.headers[h];
        if (v !== undefined) res.setHeader(h, v);
      });
      const contentLength = Number(upRes.headers['content-length']);
      const crMatch = String(upRes.headers['content-range'] || '').match(/\/(\d+)$/);
      const total = crMatch ? Number(crMatch[1]) : (Number.isFinite(contentLength) ? contentLength : null);
      const progress = progressLogger({ label, total, startedAt: Date.now() });
      let finished = false;
      firstByteTimer = setTimeout(() => {
        proxyReq.destroy(new Error('No audio data from source'));
      }, FIRST_BYTE_TIMEOUT_MS);
      upRes.on('data', (chunk) => { clearTimeout(firstByteTimer); progress.add(chunk.length); });
      upRes.on('end', () => { clearTimeout(firstByteTimer); finished = true; progress.finish(); resolve(); });
      upRes.on('error', (err) => { clearTimeout(firstByteTimer); finished = true; progress.abort(); logErrDetail(`${label} upRes`, err); reject(new Error(describeErr(err), { cause: err })); });
      // Aborto a mitad sin 'end' ni 'error' → no dejar colgada la promesa.
      upRes.on('close', () => {
        clearTimeout(firstByteTimer);
        if (!finished) { finished = true; progress.abort(); reject(new Error('Stream aborted')); }
      });
      upRes.pipe(res);
    });

    proxyReq.on('error', (err) => { clearTimeout(firstByteTimer); logErrDetail(`${label} proxyReq`, err); reject(new Error(describeErr(err), { cause: err })); });
    proxyReq.setTimeout(120000, () => proxyReq.destroy(new Error('proxy timeout')));
    // Liberar la conexión upstream si el cliente se desconecta.
    req.on('close', () => { if (!proxyReq.destroyed) proxyReq.destroy(); });
    proxyReq.end();
  });
}

// ── Transcode en vivo a m4a (para webm/opus que Safari no reproduce) ──
export function transcodeStream(req, res, url, label = 'transcode') {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'error',
        '-user_agent', UA,
        // ffmpeg soporta -http_proxy (solo http/https, no socks): el media
        // transcodeado también debe salir por la IP del resolve si hay proxy.
        ...(YTDLP_PROXY_HTTP ? ['-http_proxy', YTDLP_PROXY_HTTP] : []),
        ...(getCookieHeader() ? ['-cookies', getCookieHeader()] : []),
        '-i', withRateBypass(url),
        '-vn', '-acodec', 'aac', '-b:a', '128k',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { reject(new Error('ffmpeg unavailable')); return; }
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Cache-Control', 'no-store');
    const progress = progressLogger({ label, total: null, startedAt: Date.now() });
    let finished = false, failed = false, aborted = false;
    let stderr = '';
    const firstByteTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('No audio data from ffmpeg'));
    }, FIRST_BYTE_TIMEOUT_MS);
    if (child.stdout) {
      child.stdout.on('data', (chunk) => { clearTimeout(firstByteTimer); progress.add(chunk.length); });
      child.stdout.pipe(res);
    }
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(firstByteTimer); failed = true; logErrDetail(`${label} ffmpeg`, err); reject(new Error(describeErr(err), { cause: err })); });
    req.on('close', () => {
      aborted = true; // el cliente se fue → no fue una finalización natural
      try { child.kill('SIGKILL'); } catch {}
    });
    child.on('close', (code) => {
      clearTimeout(firstByteTimer);
      finished = true;
      if (aborted) { progress.abort(); resolve(); return; }
      if (failed) { progress.abort(); reject(new Error('ffmpeg error')); return; }
      if (code === 0) { progress.finish(); resolve(); }
      else { progress.abort(); reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 150)}`)); }
      res.end();
    });
  });
}

// ── Bypass de rate-limit de googlevideo ──
// Añade ratebypass=yes a las URLs de googlevideo: evita el throttling de
// descarga cuando se solicitan streams con rapidez desde la misma IP.
export function withRateBypass(url) {
  try {
    const u = new URL(url);
    if (/googlevideo/i.test(u.hostname)) { u.searchParams.set('ratebypass', 'yes'); return u.toString(); }
    return url;
  } catch { return url; }
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

// Sirve un Buffer completo (memoria o leído de disco) con soporte de Range
// (206) para que el reproductor pueda hacer seek sobre archivos cacheados.
function serveBuffer(res, buf) {
  res.status(200);
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const range = res.req?.headers?.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(String(range));
    if (m) {
      const total = buf.length;
      let start = m[1] ? parseInt(m[1], 10) : NaN;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (!m[1] && m[2]) start = Math.max(0, total - parseInt(m[2], 10)); // sufijo bytes=-N
      if (Number.isNaN(start) || start >= total || start > (Number.isNaN(end) ? total - 1 : end)) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      if (Number.isNaN(end)) end = total - 1;
      end = Math.min(end, total - 1);
      const slice = buf.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(slice.length));
      res.end(slice);
      return;
    }
  }

  res.setHeader('Content-Length', String(buf.length));
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
    try {
      parsed = new URL(withRateBypass(url));
    } catch (err) {
      // Diagnóstico COMPLETO: URL íntegra (escape de \n/\r/controles), el error
      // real del parser y la versión de Node (diferencias entre versiones).
      const full = String(url).replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      console.warn(`[music-stream] ⚠️ URL inválida (len ${String(url).length}, node ${process.version}): ${full}`);
      console.warn(`[music-stream] ⚠️   error parser: ${err?.message || err}`);
      reject(new Error('Invalid stream URL'));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    // Proxy residencial: mismo requisito que en proxyStream — la URL está ligada
    // a la IP del resolve y el media debe salir por el mismo proxy.
    const agent = getProxyAgent();
    const cookieHeader = getCookieHeader();
    const out = lib.get(parsed, {
      headers: cookieHeader ? { 'User-Agent': UA, Cookie: cookieHeader } : { 'User-Agent': UA },
      agent: agent || false,
    }, (upRes) => {
      if (upRes.statusCode !== 200) {
        upRes.resume();
        reject(new Error(`download HTTP ${upRes.statusCode}`));
        return;
      }
      const startedAt = Date.now();
      let started = false, finished = false, total = 0;
      const chunks = [];
      const firstByteTimer = setTimeout(() => {
        // Sin datos en 20s → URL muerta (googlevideo 0 bytes)
        out.destroy(new Error('No audio data from source'));
      }, FIRST_BYTE_TIMEOUT_MS);
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
      upRes.on('error', (err) => { clearTimeout(firstByteTimer); finished = true; logErrDetail(`${label} download upRes`, err); reject(new Error(describeErr(err), { cause: err })); });
      // Aborto a mitad de transferencia sin 'end' ni 'error' → no dejar colgada la promesa.
      upRes.on('close', () => {
        if (!finished) { clearTimeout(firstByteTimer); reject(new Error('Download aborted')); }
      });
      // Cliente se desconecta con backpressure activo → seguir descargando para cachear.
      res.on('close', () => { if (!upRes.destroyed) upRes.resume(); });
    });
    out.on('error', (err) => { logErrDetail(`${label} download out`, err); reject(new Error(describeErr(err), { cause: err })); });
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
        // ffmpeg soporta -http_proxy (solo http/https, no socks): el media
        // transcodeado también debe salir por la IP del resolve si hay proxy.
        ...(YTDLP_PROXY_HTTP ? ['-http_proxy', YTDLP_PROXY_HTTP] : []),
        ...(getCookieHeader() ? ['-cookies', getCookieHeader()] : []),
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
    }, FIRST_BYTE_TIMEOUT_MS);
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
    child.on('error', (err) => { clearTimeout(firstByteTimer); finished = true; logErrDetail(`${label} transcode`, err); reject(new Error(describeErr(err), { cause: err })); });
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

// Primer byte: 20s (antes 12s) — googlevideo con throttling tarda más en
// empezar a mandar datos; 12s provocaba falsos "No audio data".
const FIRST_BYTE_TIMEOUT_MS = 20000;

// ── Backoff largo de reintento ──
// El 403 transitorio de googlevideo (anti-abuso por burst de resolución de
// yt-dlp) dura ~30s y afecta a TODAS las URLs (incluso frescas) mientras está
// activo. Los reintentos cortos (1-2s) nunca lo sobreviven → el primer play de
// una canción sin cache fallaba y el app caía al preview de 30s. Este backoff
// espera el cooldown y reintenta la MISMA URL (que no está muerta).
const RETRY_BACKOFF_LONG_MS = 20000;

// ── Anti rate-limit de googlevideo ──
// El throttling se dispara con RÁFAGAS de descargas simultáneas (misma IP).
// Límite global de descargas concurrentes: si se supera, se ESPERA a que se
// libere un slot (cola con backoff) en vez de disparar otra en paralelo.
const MAX_SIMULTANEOUS_DOWNLOADS = 2;
let activeDownloads = 0;
const downloadWaiters = [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Espera (máx 15s) a que haya un slot de descarga libre; si no, lanza error. */
async function acquireDownloadSlot() {
  if (activeDownloads < MAX_SIMULTANEOUS_DOWNLOADS) { activeDownloads += 1; return; }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Too many concurrent downloads, try again')), 15000);
    downloadWaiters.push(() => { clearTimeout(timer); resolve(); });
  });
  activeDownloads += 1;
}
function releaseDownloadSlot() {
  activeDownloads = Math.max(0, activeDownloads - 1);
  const next = downloadWaiters.shift();
  if (next) next();
}

/**
 * Pipeline unificado de audio (usado por /stream y /download):
 *  1. Caché memoria → instantáneo. 2. Disco → leer + cachear. 3. Descarga
 *     progresiva a googlevideo con reintentos (misma URL → con backoff →
 *     resolución fresca) y límite de simultáneas. 4. Cachea en memoria/disco.
 * `mode` solo cambia el prefijo de los logs ('stream' vs 'download').
 */
async function serveAudio(req, res, { artist = '', title = '', duration = 0, fresh = false, mode = 'download' } = {}) {
  const startedAt = Date.now();
  const label = `${artist} - ${title}`.trim() || mode;
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
      console.info(`[music-stream] ${mode === 'stream' ? '▶' : '⬇'} ${label} · memoria ${(mem.length / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
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
        console.info(`[music-stream] ${mode === 'stream' ? '▶' : '⬇'} ${label} · disco ${(diskBuf.length / 1048576).toFixed(1)} MB · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
        return;
      } catch { /* seguir con descarga */ }
    }

    // 3) Ya hay una descarga en vuelo (misma canción) → esperar y servir desde memoria.
    if (inflightDownload.has(key)) {
      await inflightDownload.get(key);
      const b = getMemAudio(key);
      if (b) { serveBuffer(res, b); return; }
      throw new Error('Background download failed');
    }

    const playable = isBrowserPlayableMime(resolved.mime);
    const doStream = (url) => (playable
      ? streamDownloadToResponse(res, url, cachePath, key)
      : streamTranscodeToResponse(res, url, cachePath, key)
    );

    // Slot de descarga adquirido AQUÍ (mismo scope que el try/finally): si
    // acquireDownloadSlot() rechaza (sin slot en 15s), el catch de abajo responde
    // 502 y el finally NO libera un slot que nunca se tomó (el contador no se
    // corrompe ni se despiertan waiters en cascada).
    await acquireDownloadSlot();
    let slotAcquired = true;

    // Diagnóstico del URL que entra al stream (ocasional — 1 de cada 20 para no ensuciar).
    if (Math.random() < 0.05) {
      console.info(`[music-stream] 🔗 ${label} · url len ${String(resolved.url).length} · ${String(resolved.url).slice(0, 80)}`);
    }

    const p = attemptStreamWithRetries({
      label,
      url: resolved.url,
      doStream,
      res,
      refresh: () => resolveStream({ artist, title, duration }, { fresh: true }),
      // La URL poisoned también sale de la caché en el path de descarga.
      onPoisoned: () => invalidateStreamCache(artist, title),
    });

    p
      .then(() => {
        console.info(`[music-stream] ⬇ ${label} · servido+${playable ? 'descargado' : 'transcodificado'} y cacheado · total ${((Date.now() - startedAt) / 1000).toFixed(1)}s (resolve ${resolveSecs}s)`);
        evictDownloadCache();
      })
      .catch((err) => {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, describeErr(err));
        if (!res.headersSent && !res.destroyed) res.status(502).json({ success: false, error: describeErr(err) });
        else if (!res.writableEnded) res.end();
      });

    inflightDownload.set(key, p);
    try { await p; } finally {
      inflightDownload.delete(key);
      if (slotAcquired) releaseDownloadSlot();
    }
  } catch (err) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.warn(`[music-stream] ✗ ${label} · error a los ${elapsed}s:`, describeErr(err));
    if (!res.headersSent && !res.destroyed) res.status(502).json({ success: false, error: describeErr(err) });
  }
}

export async function handleDownloadRequest(req, res, opts) {
  return serveAudio(req, res, { ...opts, mode: 'download' });
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
    proxy: getProxyStatus(),
  };
  if (ytdlp) {
    try { const { stdout } = await runYtDlp(['--version']); data.ytdlpVersion = stdout.trim().split('\n')[0] || null; } catch {}
  }
  healthCache = { at: Date.now(), data };
  return data;
}
