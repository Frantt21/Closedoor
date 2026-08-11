/**
 * api/_tailscaleSetup.js — Auto-setup de Tailscale para el container, SIN consola.
 *
 * El server (music-server.js) no tiene shell: el startup es solo `node
 * music-server.js`. Este módulo hace TODO el trabajo del túnel residencial
 * (Termux + Tailscale) por sí solo, en segundo plano:
 *
 *   1. Si ya hay proxy configurado (YTDLP_PROXY / proxy.conf) → no hace nada.
 *   2. Descarga el binario estático de Tailscale (auto-detecta arquitectura;
 *      formato real verificado: tailscale_<ver>_<arch>.tgz — SIN "linux").
 *   3. Arranca tailscaled en userspace (--tun=userspace-networking, sin root).
 *   4. Si no está autenticado, lanza `tailscale up --hostname=hidencloud-music`
 *      y EXTRAE el link de login (https://login.tailscale.com/a/...) de su
 *      salida → lo imprime EN LOS LOGS, bien visible. El usuario abre ese link
 *      en su navegador y acepta con la MISMA cuenta que el teléfono.
 *   5. Hace polling de `tailscale status --json` hasta que el usuario
 *      autentique (los links expiran → re-lanza `up` y reimprime el link).
 *   6. Al conectar, avisa a music-server.js vía onProxyReady → este llama a
 *      autoConfigureProxy() de _musicStream.js, que detecta el teléfono
 *      (peer termux-phone) y escribe proxy.conf + aplica el agente SOCKS.
 *   7. Watchdog: si el proxy deja de ser alcanzable (teléfono dormido / IP
 *      vieja), reintenta la detección en background. Nunca bloquea el arranque.
 */

import { spawn } from 'child_process';
import { existsSync, chmodSync, mkdirSync, writeFileSync, appendFileSync, statSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
// Override para tests y para desplegar el binario en otra ruta.
const BIN_DIR = process.env.TAILSCALE_BIN_DIR || join(ROOT_DIR, 'bin');
const TS_STATE_DIR = join(homedir(), '.tailscale');
const TS_SOCK = join(TS_STATE_DIR, 'tailscaled.sock');
const TS_STATE = join(TS_STATE_DIR, 'tailscaled.state');
const TS_LOG = join(BIN_DIR, 'tailscaled.log');
const UP_LOG = join(BIN_DIR, 'tailscale-up.log');
const UP_PID = join(BIN_DIR, '.tailscale-up.pid');
const TS_FALLBACK_VERSION = '1.102.2';

function log(...a) { console.log('[ts-setup]', ...a); }
function warn(...a) { console.warn('[ts-setup] ⚠️', ...a); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function detectArch() {
  if (process.platform !== 'linux') return null;
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'arm') return 'arm';
  return null;
}

// ── Descarga con fetch (Node 18+, sigue redirects) ────────────
async function downloadWithFetch(url, dest) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

// ── Detectar última versión estable ──
async function detectLatestVersion(arch) {
  try {
    const res = await fetch('https://pkgs.tailscale.com/stable/', {
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const re = new RegExp(`tailscale_([0-9.]+)_${arch}\\.tgz`, 'g');
    const found = new Set();
    let m;
    while ((m = re.exec(html))) found.add(m[1]);
    const sorted = [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (sorted.length) return sorted[sorted.length - 1];
  } catch {}
  return TS_FALLBACK_VERSION;
}

// ── Binarios tailscale/tailscaled (bin/ o PATH) ──
function findTsBin(name) {
  const local = join(BIN_DIR, name);
  if (existsSync(local)) return local;
  return name; // PATH fallback (spawn lo resuelve; si falta → error manejado)
}

async function ensureBinaries() {
  const tsPath = join(BIN_DIR, 'tailscale');
  const tsdPath = join(BIN_DIR, 'tailscaled');
  const have = existsSync(tsPath) && existsSync(tsdPath);
  if (!have) {
    const arch = detectArch();
    if (!arch) {
      warn(`arquitectura no soportada (${process.platform} ${process.arch}) → sin túnel Tailscale`);
      return false;
    }
    const version = await detectLatestVersion(arch);
    const url = `https://pkgs.tailscale.com/stable/tailscale_${version}_${arch}.tgz`;
    const tmp = `/tmp/tailscale-${arch}.tgz`;
    log(`descargando binario estático Tailscale ${version} (${arch})...`);
    try {
      await downloadWithFetch(url, tmp);
      mkdirSync(BIN_DIR, { recursive: true });
      await extractTar(tmp, BIN_DIR, ['tailscale', 'tailscaled']);
      try { unlinkSync(tmp); } catch {}
    } catch (err) {
      warn(`fallo la descarga del binario Tailscale (${err.message}) → se reintentará en el próximo ciclo`);
      return false;
    }
  }
  try { chmodSync(tsPath, 0o755); } catch {}
  try { chmodSync(tsdPath, 0o755); } catch {}
  if (!existsSync(tsPath) || !existsSync(tsdPath)) {
    warn('binarios tailscale/tailscaled no disponibles tras la descarga');
    return false;
  }
  return true;
}

function extractTar(tarball, dest, members) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', tarball, '-C', dest, ...members], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      // Fallback: extraer todo (algunos tarballs no traen miembros sueltos).
      const child2 = spawn('tar', ['-xzf', tarball, '-C', dest], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err2 = '';
      child2.stderr?.on('data', (d) => { err2 += d; });
      child2.on('close', (c2) => c2 === 0 ? resolve() : reject(new Error(`tar exit ${c2}: ${(stderr || err2).slice(0, 150)}`)));
    });
    child.on('error', reject);
  });
}

// ── Estado del daemon (¿responde por el socket?) ──
function runTs(args, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const bin = findTsBin('tailscale');
    const child = spawn(bin, ['--socket', TS_SOCK, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '', settled = false;
    const done = (v) => { if (settled) return; settled = true; clearTimeout(t); resolve(v); };
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done({ code: -2, stdout: out, stderr: err, timedOut: true }); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('close', (code) => done({ code, stdout: out, stderr: err }));
    child.on('error', (e) => done({ code: -3, stdout: out, stderr: String(e?.message || e) }));
  });
}

function isDaemonUp() {
  // El socket existe es buena señal; el status confirma que responde.
  return new Promise((resolve) => {
    try { if (!existsSync(TS_SOCK)) return resolve(false); } catch { return resolve(false); }
    runTs(['status', '--json'], { timeoutMs: 5000 }).then((r) => {
      if (r.code === 0) return resolve(true);
      // Daemon vivo pero no autenticado aún → status devuelve != 0, pero el
      // socket existe → considerar "up" (el login viene después).
      resolve(true);
    });
  });
}

// ── Arrancar el daemon (userspace, sin root, detached) ──
function ensureDaemon() {
  return new Promise(async (resolve) => {
    if (await isDaemonUp()) return resolve(true);
    const tsd = findTsBin('tailscaled');
    mkdirSync(TS_STATE_DIR, { recursive: true });
    mkdirSync(BIN_DIR, { recursive: true });
    try { if (statSync(TS_LOG).size > 1_000_000) writeFileSync(TS_LOG, ''); } catch {}
    log('arrancando daemon tailscaled (userspace)...');
    const child = spawn(tsd, [
      '--statedir', TS_STATE,
      '--socket', TS_SOCK,
      '--tun', 'userspace-networking',
      '--socks5-server', 'localhost:1055',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.unref();
    child.stdout?.on('data', (d) => { try { appendFileSync(TS_LOG, d); } catch {} });
    child.stderr?.on('data', (d) => { try { appendFileSync(TS_LOG, d); } catch {} });
    child.on('exit', (code, sig) => {
      warn(`daemon tailscaled salió (${sig ? `signal ${sig}` : `code ${code}`}) → mira ${TS_LOG}`);
    });
    child.on('error', (e) => warn(`no se pudo lanzar tailscaled: ${e.message}`));
    // Esperar a que cree el socket (hasta ~15s).
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if (existsSync(TS_SOCK)) { log('daemon listo (socket creado)'); return resolve(true); }
    }
    warn(`el daemon no creó el socket en 15s → mira ${TS_LOG}`);
    resolve(false);
  });
}

// ── Estado de conexión (¿autenticado + con IP?) ──
async function isConnected() {
  const r = await runTs(['status', '--json'], { timeoutMs: 8000 });
  if (r.code !== 0) return false;
  try {
    const j = JSON.parse(r.stdout);
    return !!(j?.Self?.TailscaleIPs?.length);
  } catch { return false; }
}

// ── Link de login: lanza `tailscale up` y extrae la URL ──
let upProc = null;
let loginUrlShown = false;

function printLoginLink(url) {
  loginUrlShown = true;
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  🔗 AUTENTICA TAILSCALE DEL CONTAINER (una vez):');
  console.log('  Abre este link en tu navegador y acepta con la MISMA cuenta');
  console.log('  con la que autenticaste el teléfono (termux-phone):');
  console.log('');
  console.log(`      ${url}`);
  console.log('');
  console.log('  El server detectará la conexión SOLO y configurará el proxy.');
  console.log('  (Si el link expira, se imprimirá uno nuevo aquí.)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');
}

function ensureUpRunning() {
  if (upProc && !upProc.killed) return;
  const ts = findTsBin('tailscale');
  try { if (statSync(UP_LOG).size > 1_000_000) writeFileSync(UP_LOG, ''); } catch {}
  upProc = spawn(ts, ['--socket', TS_SOCK, 'up', '--hostname=hidencloud-music'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  upProc.unref();
  try { writeFileSync(UP_PID, String(upProc.pid), 'utf8'); } catch {}
  // ⚠️ El output del `up` llega EN CHUNKS: el link puede cortarse entre dos
  // data events (verificado en test: ".../a" y luego "fake123456\n"). Se
  // acumula el buffer y se re-escanea completo en cada chunk, así el regex
  // siempre encuentra la URL entera una vez que llegó.
  let upBuffer = '';
  const onData = (d) => {
    const text = String(d);
    upBuffer = (upBuffer + text).slice(-4096);
    try { appendFileSync(UP_LOG, text); } catch {}
    // La URL real es https://login.tailscale.com/a/<token> — el token y la `/`
    // tras "a" deben entrar en el match (un patrón [a-z0-9]+ se cortaba en la
    // barra y el link salía truncado a .../a).
    const m = upBuffer.match(/https:\/\/login\.tailscale\.com\/[a-z0-9/-]+/i);
    if (m) printLoginLink(m[0]);
  };
  upProc.stdout?.on('data', onData);
  upProc.stderr?.on('data', onData);
  upProc.on('exit', () => { upProc = null; try { unlinkSync(UP_PID); } catch {} });
  upProc.on('error', () => { upProc = null; });
}

// ── Bucle principal: conectar (o esperar auth) y avisar ──
let loopRunning = false;

export async function startTailscaleAutoSetup({ onProxyReady, checkProxyConfigured } = {}) {
  if (loopRunning) return;
  loopRunning = true;
  try {
    // Ya hay proxy → no hacer nada (el watchdog solo re-verifica).
    if (checkProxyConfigured && checkProxyConfigured()) {
      log('proxy ya configurado → auto-setup de Tailscale saltado');
      return;
    }
    const ok = await ensureBinaries();
    if (!ok) { warn('sin binarios Tailscale → el proxy se mantiene sin configurar (reintento en el watchdog)'); return; }
    await ensureDaemon();
    if (await isConnected()) {
      log('Tailscale ya conectado → detectando teléfono...');
      await onProxyReady?.();
      return;
    }
    // No autenticado: lanzar `up` (imprime el link en los logs) y hacer
    // polling. Los links de auth expiran → re-lanzar `up` cuando muera.
    log('Tailscale no autenticado → lanzando login (mira el link en los logs)...');
    ensureUpRunning();
    for (let i = 0; i < 60; i++) { // ~5 min de polling (el login es manual)
      await sleep(5000);
      if (await isConnected()) {
        log('Tailscale conectado después de autenticación → detectando teléfono...');
        await onProxyReady?.();
        return;
      }
      // El proceso `up` murió sin autenticar (link expirado) → re-lanzarlo.
      if (!upProc || upProc.killed) {
        loginUrlShown = false;
        ensureUpRunning();
      }
    }
    // El `up` real bloquea esperando auth INDEFINIDAMENTE (proceso vivo). Si se
    // deja vivo, el watchdog jamás relanza un `up` nuevo y el link impreso
    // (que expira, login.tailscale.com caduca) queda obsoleto para siempre.
    // Se mata el proceso para que el siguiente ciclo del watchdog lance uno
    // NUEVO y reimprima un link fresco. También se reinicia el flag de impresión.
    try { if (upProc && !upProc.killed) upProc.kill('SIGKILL'); } catch {}
    upProc = null;
    loginUrlShown = false;
    warn('sin autenticación de Tailscale tras 5 min → el proxy se mantiene sin configurar');
    warn('  (el watchdog reintentará y reimprimirá un link nuevo si el anterior expiró)');
  } finally {
    loopRunning = false;
  }
}

// ── Watchdog: re-verifica cada N ms mientras no haya proxy alcanzable ──
export function startProxyWatchdog({ onProxyReady, checkProxyConfigured, checkReachable, intervalMs = 60000 } = {}) {
  const tick = async () => {
    try {
      if (checkProxyConfigured && checkProxyConfigured()) {
        if (checkReachable && (await checkReachable().catch(() => false))) return; // todo OK
        // Configurado pero no alcanzable (teléfono dormido/IP vieja) → forzar la
        // re-detección (force=true evita el early-return de autoConfigureProxy).
        await onProxyReady?.({ force: true });
        return;
      }
      // No configurado → reintentar el auto-setup completo.
      await startTailscaleAutoSetup({ onProxyReady, checkProxyConfigured });
    } catch (err) {
      warn('watchdog del proxy falló:', err?.message || err);
    }
  };
  const iv = setInterval(tick, intervalMs);
  iv.unref?.();
  return iv;
}
