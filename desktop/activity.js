/**
 * activity.js — detecta qué está haciendo el usuario en su equipo (música,
 * vídeo y juegos) para mostrarlo dentro de la app.
 *
 * CONTEXTO: la web no puede leer procesos ni sesiones multimedia del sistema
 * (el navegador lo prohíbe). Solo la app de escritorio puede, así que la
 * detección vive en el proceso principal y la web la consume por IPC
 * (desktop/preload.js → window.electron.activity).
 *
 * QUÉ SE DETECTA (por plataforma, todo best-effort — si falla, null):
 *   · Windows  → SMTC (GlobalSystemMediaTransportControlsSessionManager), la
 *                misma API que alimenta el widget multimedia de Windows 11.
 *                Cubre Spotify, navegadores, VLC, etc. Juegos: Steam (registro
 *                RunningAppID + appmanifest del juego).
 *   · Linux    → MPRIS vía `playerctl`. Juegos: procesos cuyo cwd está dentro
 *                de `steamapps/common` (truco fiable y sin depender de Steam).
 *   · macOS    → AppleScript contra Spotify/Música. Juegos: no se intenta.
 *
 * NADA de esto sale del equipo por sí solo: este módulo solo devuelve un objeto
 * normalizado. Qué se hace con él (mostrarlo, guardarlo) lo decide el renderer.
 *
 * El sondeo es por polling (~10 s) porque ninguna de las tres APIs ofrece
 * eventos que podamos escuchar desde Node; se cachea el último resultado y solo
 * se notifica cuando cambia de verdad.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Intervalo de sondeo. Barato: una consulta cada 10 s, y solo con cambios se avisa. */
const POLL_INTERVAL_MS = 10000;
/** Techo por consulta: si el sistema no responde, no se acumulan procesos colgados. */
const QUERY_TIMEOUT_MS = 5000;

/** Último resultado conocido (null = no hay actividad). */
let currentActivity = null;
/** Id del setInterval, o null si el watcher está parado. */
let pollTimer = null;
/** `true` mientras hay una consulta en vuelo (evita solapamientos en equipos lentos). */
let queryInFlight = false;
/** Callback a invocar cuando cambia la actividad. */
let onChangeHandler = null;

// ── Utilidades ──

/** `execFile` en promesa, con timeout y sin heredar entorno raro. */
function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: QUERY_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        ...options,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout || ''));
      },
    );
  });
}

/** Quita el BOM y espacios que PowerShell añade al serializar. */
function clean(text) {
  return String(text || '').replace(/^\uFEFF/, '').trim();
}

/** Normaliza el objeto de actividad y descarta entradas vacías. */
function makeActivity({ kind, title, subtitle, album, app, url }) {
  const cleanTitle = String(title || '').trim();
  if (!kind || !cleanTitle) return null;
  return {
    kind,
    title: cleanTitle,
    subtitle: String(subtitle || '').trim() || null,
    album: String(album || '').trim() || null,
    app: String(app || '').trim() || null,
    url: String(url || '').trim() || null,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Nombre «bonito» de la app a partir del id que da cada API
 * ("Spotify.exe" → "Spotify", "Mozilla_firefox" → "Firefox").
 */
function prettyAppName(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const base = value.replace(/\.exe$/i, '').replace(/^.*[/\\]/, '');
  const known = {
    spotify: 'Spotify',
    brave: 'Brave',
    chrome: 'Chrome',
    msedge: 'Edge',
    firefox: 'Firefox',
    mozilla_firefox: 'Firefox',
    vlc: 'VLC',
    music: 'Apple Music',
    itunes: 'Apple Music',
    'Microsoft.ZuneMusic': 'Media Player',
    'Microsoft.ZuneVideo': 'Films & TV',
    // Nombres de proceso comunes en Windows (el .exe real lo añade la lista).
    code: 'VS Code',
    discord: 'Discord',
    steam: 'Steam',
    windowsterminal: 'Windows Terminal',
    githubdesktop: 'GitHub Desktop',
    robloxplayerbeta: 'Roblox',
    obs64: 'OBS Studio',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
    zoom: 'Zoom',
    notepad: 'Notepad',
    explorer: 'File Explorer',
    epicgameslauncher: 'Epic Games Launcher',
    radeonsoftware: 'AMD Radeon Software',
  };
  const mapped = known[base.toLowerCase()] || known[base];
  if (mapped) return mapped;
  // Sin nombre bonito, al menos no gritar en minúsculas ("hydra" → "Hydra").
  return base === base.toLowerCase() ? base.charAt(0).toUpperCase() + base.slice(1) : base;
}

// ── Windows: SMTC ──

/**
 * Script de PowerShell que consulta SMTC. Va embebido (y se ejecuta con
 * `-EncodedCommand`) para no depender de archivos sueltos que habría que
 * declarar en `build.files` de electron-builder.
 *
 * Requiere Windows PowerShell 5.1 (el `pwsh` de .NET Core no proyecta WinRT).
 */
const WIN_MEDIA_PS = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$chosen = $null
foreach ($s in $mgr.GetSessions()) {
  $info = $s.GetPlaybackInfo()
  if ($info.PlaybackStatus -eq 4) { $chosen = $s; break }
}
if ($null -eq $chosen) { exit 0 }
$props = Await ($chosen.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$payload = [ordered]@{
  app    = $chosen.SourceAppUserModelId
  title  = $props.Title
  artist = $props.Artist
  album  = $props.AlbumTitle
}
[Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
`;

/** Comando de PowerShell ya codificado (UTF-16LE/base64), se calcula una vez. */
const WIN_MEDIA_ENCODED = Buffer.from(WIN_MEDIA_PS, 'utf16le').toString('base64');

/** ¿Parece vídeo? Solo para etiquetar la actividad; no afecta a la detección. */
function looksLikeVideo(title, app) {
  const text = `${title} ${app}`.toLowerCase();
  return /(youtube|netflix|disney|prime video|hbo|max\b|twitch|plex|vlc|films|zunevideo|video)/.test(text);
}

/** Media en reproducción en Windows (solo si está sonando, no en pausa). */
async function detectWindowsMedia() {
  const output = clean(
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      WIN_MEDIA_ENCODED,
    ]),
  );
  const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith('{'));
  if (!line) return null;

  const data = JSON.parse(line);
  const app = prettyAppName(data.app);
  return makeActivity({
    kind: looksLikeVideo(data.title, data.app) ? 'video' : 'music',
    title: data.title,
    subtitle: data.artist,
    album: data.album,
    app,
  });
}

// ── Windows: juegos de Steam ──

/** Ejecuta `reg query` y devuelve el valor de la clave pedida, o null. */
async function readRegistryValue(key, name) {
  try {
    const output = await run('reg.exe', ['query', key, '/v', name]);
    const match = output.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i'));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Extrae el campo `"name"` de un appmanifest de Steam. */
function readAppManifestName(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const match = raw.match(/"name"\s+"([^"]+)"/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Juego en ejecución según Steam: el registro guarda `RunningAppID` mientras
 * hay un juego abierto; con ese id se busca el `appmanifest_<id>.acf` en las
 * bibliotecas para sacar el nombre real.
 */
async function detectWindowsSteamGame() {
  const runningId = await readRegistryValue('HKCU\\Software\\Valve\\Steam', 'RunningAppID');
  const appId = Number.parseInt(runningId || '0', 10);
  if (!Number.isFinite(appId) || appId <= 0) return null;

  const steamPathRaw =
    (await readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')) ||
    'C:\\Program Files (x86)\\Steam';
  const steamPath = steamPathRaw.replace(/\//g, path.sep);

  // Bibliotecas: la propia + las de libraryfolders.vdf
  const libraries = [path.join(steamPath, 'steamapps')];
  try {
    const vdf = fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) {
      libraries.push(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps'));
    }
  } catch {
    // sin VDF: basta con la biblioteca principal
  }

  for (const library of libraries) {
    const name = readAppManifestName(path.join(library, `appmanifest_${appId}.acf`));
    if (name) return makeActivity({ kind: 'game', title: name, app: 'Steam' });
  }

  // El juego corre pero no encontramos el manifiesto: al menos consta que juega.
  return makeActivity({ kind: 'game', title: `Steam App ${appId}`, app: 'Steam' });
}

// ── Linux / macOS: media ──

/**
 * Media en reproducción por MPRIS (`playerctl`). Devuelve la primera sesión en
 * estado Playing; si playerctl no está instalado, el error se traga y no hay
 * actividad.
 */
async function detectLinuxMedia() {
  const format = '{{status}}\\t{{playerName}}\\t{{artist}}\\t{{title}}\\t{{album}}\\t{{xesam:url}}';
  const output = clean(await run('playerctl', ['-a', 'metadata', '--format', format]));
  if (!output) return null;

  for (const line of output.split(/\r?\n/)) {
    const [status, player, artist, title, album, url] = line.split('\t');
    if (status !== 'Playing' || !title) continue;
    return makeActivity({
      kind: looksLikeVideo(title, player) ? 'video' : 'music',
      title,
      subtitle: artist,
      album,
      app: prettyAppName(player),
      url,
    });
  }
  return null;
}

/** AppleScript que pregunta a Spotify y Música qué suena ahora. */
const MAC_MEDIA_SCRIPT = `
set output to ""
tell application "System Events"
  set spotifyRunning to (exists (processes where name is "Spotify"))
  set musicRunning to (exists (processes where name is "Music"))
end tell
if spotifyRunning then
  try
    tell application "Spotify"
      if player state is playing then
        set output to "Spotify" & tab & artist of current track & tab & name of current track & tab & album of current track
      end if
    end tell
  end try
end if
if output is "" and musicRunning then
  try
    tell application "Music"
      if player state is playing then
        set output to "Music" & tab & artist of current track & tab & name of current track & tab & album of current track
      end if
    end tell
  end try
end if
return output
`;

/** Media en reproducción en macOS (Spotify o Apple Music). */
async function detectMacMedia() {
  const output = clean(await run('osascript', ['-e', MAC_MEDIA_SCRIPT]));
  if (!output) return null;

  const [app, artist, title, album] = output.split('\t');
  return makeActivity({
    kind: looksLikeVideo(title, app) ? 'video' : 'music',
    title,
    subtitle: artist,
    album,
    app: prettyAppName(app),
  });
}

// ── Linux: juegos de Steam ──

/**
 * Juego de Steam en Linux mirando el cwd de los procesos: los juegos se lanzan
 * desde `steamapps/common/<Juego>`, así que el symlink /proc/<pid>/cwd lo
 * delata sin depender de APIs de Steam.
 */
async function detectLinuxSteamGame() {
  let pids = [];
  try {
    pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }

  for (const pid of pids) {
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      const match = cwd.match(/steamapps\/common\/([^/]+)/);
      if (match) return makeActivity({ kind: 'game', title: match[1], app: 'Steam' });
    } catch {
      // proceso desaparecido o sin permisos: siguiente
    }
  }
  return null;
}

// ── Programas abiertos (selector de Ajustes → Actividad) ──

/** Ruido del sistema: procesos que no son "programas que el usuario abrió". */
const APP_NOISE = new Set([
  'electron',
  'node',
  'conhost',
  'cmd',
  'powershell',
  'pwsh',
  'bash',
  'sh',
  'zsh',
  'systemsettings',
  'textinputhost',
  'applicationframehost',
  'shellexperiencehost',
  'searchhost',
  'startmenuexperiencehost',
  'lockapp',
  'dwm',
  'wininit',
  'csrss',
  'svchost',
  'explorer',
  'gnome-shell',
  'kwin_x11',
  'kwin_wayland',
  'plasmashell',
  'systemd',
  'dbus-daemon',
  'dbus-broker',
  'gvfsd',
  'xdg-desktop-portal',
  'pipewire',
  'wireplumber',
  'pulseaudio',
  'xfwm4',
  'mutter',
  'xdg-desktop-portal-gnome',
  'gnome-shell-extension',
  // Ayudantes de Windows que aparecen en la sesión pero no son programas que el
  // usuario abra: drivers de GPU/audio, tareas del shell y helpers de otras apps.
  'ctfmon',
  'dllhost',
  'fontdrvhost',
  'runtimebroker',
  'sihost',
  'taskhostw',
  'msmpeng',
  'securityhealthsystray',
  'securityhealthservice',
  'smartscreen',
  'backgroundtaskhost',
  'openconsole',
  'amdrsserv',
  'amdrssrcext',
  'atieclxx',
  'atiedxx',
  'cpumetricsserver',
  'defendersessionhelper',
  'discordsystemhelper',
  'killerintelligencecenter',
  'winlogon',
  'rundll32',
  'useroobebroker',
  'searchapp',
  'steamwebhelper',
  'robloxcrashhandler',
  'rtkauduservice64',
  'cncmd',
]);

/**
 * Lista ordenada y sin duplicados a partir de los nombres crudos de proceso que
 * devuelve cada plataforma. Filtra ruido del sistema y limita el tamaño: la
 * lista se pinta en Ajustes, no es un monitor de procesos.
 *
 * Los que tienen ventana van primero: son los que el usuario reconoce de un
 * vistazo, y con el tope de la lista los procesos de fondo no los desplazan.
 *
 * @param {Array<string | {name: string, hasWindow?: boolean}>} entries
 * @returns {Array<{name: string, exe: string}>} nombre visible + ejecutable
 */
function normalizeAppList(entries) {
  const seen = new Map();
  for (const entry of entries || []) {
    const raw = typeof entry === 'string' ? entry : entry?.name;
    const hasWindow = typeof entry === 'string' ? true : entry?.hasWindow === true;
    const base = String(raw || '').trim().replace(/^.*[/\\]/, '');
    if (!base) continue;
    const key = base.toLowerCase().replace(/\.exe$/, '');
    const pretty = prettyAppName(base);
    if (!pretty || !key) continue;
    if (APP_NOISE.has(key)) continue;
    if (pretty.length > 60) continue;
    // En Windows se muestra el ejecutable; en Linux/macOS el proceso tal cual.
    const exe = /\.exe$/i.test(base)
      ? base
      : process.platform === 'win32'
        ? `${base}.exe`
        : base;
    if (!seen.has(key)) seen.set(key, { name: pretty, exe, hasWindow });
  }
  return [...seen.values()]
    .sort((a, b) => (Number(b.hasWindow) - Number(a.hasWindow)) || a.name.localeCompare(b.name))
    .slice(0, 80)
    .map(({ name, exe }) => ({ name, exe }));
}

/**
 * Procesos de la sesión del usuario en Windows, con o sin ventana.
 *
 * Antes solo se listaban los que tenían `MainWindowTitle`, y eso dejaba fuera a
 * media máquina (apps minimizadas a la bandeja, Electron, juegos con ventana
 * propia, etc.). Ahora se listan todos los de la sesión: se descartan los de
 * `SessionId 0`, que son servicios del sistema.
 */
async function listWindowsApps() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-Process | Where-Object { $_.SessionId -ne 0 } | ForEach-Object {
  $win = if ($_.MainWindowHandle -ne 0) { '1' } else { '0' }
  "$($_.ProcessName)" + [char]9 + $win
} | Sort-Object -Unique
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = clean(
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]),
  );
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, win] = line.split('\t');
      return { name, hasWindow: win === '1' };
    });
}

/** Ventanas visibles en Linux vía wmctrl; si no está instalado, cae a `ps`. */
async function listLinuxApps() {
  try {
    const output = clean(await run('wmctrl', ['-lx']));
    if (output) {
      // Formato: <id> <escritorio> <clase> <host> <título>
      const names = output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[2] || '')
        .map((cls) => cls.split('.').pop())
        .filter(Boolean);
      if (names.length) return names;
    }
  } catch {
    // sin wmctrl (X11 ausente o Wayland): probamos con los procesos
  }

  const output = clean(await run('ps', ['-u', String(os.userInfo().uid), '-o', 'comm=']));
  return output.split(/\r?\n/).map((line) => line.trim().split('/').pop()).filter(Boolean);
}

/** Procesos visibles en macOS (System Events). */
async function listMacApps() {
  const output = clean(
    await run('osascript', [
      '-e',
      'tell application "System Events" to get name of every process whose visible is true',
    ]),
  );
  return output.split(',').map((name) => name.trim()).filter(Boolean);
}

/**
 * Programas abiertos que el usuario podría compartir como actividad.
 *
 * Nunca lanza: si la plataforma falla devuelve [] y Ajustes muestra el estado
 * vacío en vez de romperse.
 *
 * @returns {Promise<Array<{name: string, exe: string}>>} ordenados y sin duplicados
 */
async function listRunningApps() {
  try {
    if (process.platform === 'win32') return normalizeAppList(await listWindowsApps());
    if (process.platform === 'linux') return normalizeAppList(await listLinuxApps());
    if (process.platform === 'darwin') return normalizeAppList(await listMacApps());
    return [];
  } catch {
    return [];
  }
}

// ── Detección por plataforma ──

/**
 * Actividad actual del usuario, o null si no hay nada en reproducción.
 * Nunca lanza: cualquier fallo de la plataforma se traduce en null.
 */
async function detectActivity() {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const media = await detectWindowsMedia().catch(() => null);
      if (media) return media;
      return await detectWindowsSteamGame().catch(() => null);
    }
    if (platform === 'linux') {
      const media = await detectLinuxMedia().catch(() => null);
      if (media) return media;
      return await detectLinuxSteamGame().catch(() => null);
    }
    if (platform === 'darwin') {
      return await detectMacMedia().catch(() => null);
    }
    return null;
  } catch {
    return null;
  }
}

/** Último resultado conocido (lo que ya se envió al renderer). */
function getActivity() {
  return currentActivity;
}

/** `true` si dos actividades son equivalentes para el usuario. */
function sameActivity(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.app === b.app &&
    a.album === b.album &&
    a.url === b.url
  );
}

/**
 * Arranca el sondeo. Solo avisa cuando la actividad cambia (comparando campos
 * relevantes; `detectedAt` se ignora para no notificar cada 10 s).
 *
 * @param {{ intervalMs?: number, onChange?: (activity: object|null) => void }} options
 * @returns {() => void} función para detener el watcher
 */
function startActivityWatcher({ intervalMs = POLL_INTERVAL_MS, onChange } = {}) {
  onChangeHandler = typeof onChange === 'function' ? onChange : null;
  if (pollTimer) return stopActivityWatcher;

  const tick = async () => {
    if (queryInFlight) return;
    queryInFlight = true;
    try {
      const next = await detectActivity();
      if (!sameActivity(next, currentActivity)) {
        currentActivity = next;
        if (onChangeHandler) onChangeHandler(next);
      }
    } finally {
      queryInFlight = false;
    }
  };

  tick(); // primera lectura inmediata, sin esperar el intervalo
  pollTimer = setInterval(tick, intervalMs);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();

  return stopActivityWatcher;
}

/** Detiene el sondeo (cierre de la app). */
function stopActivityWatcher() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  onChangeHandler = null;
}

module.exports = {
  detectActivity,
  getActivity,
  listRunningApps,
  startActivityWatcher,
  stopActivityWatcher,
  POLL_INTERVAL_MS,
};
