/**
 * preload.js — único puente entre la app de escritorio y la web publicada.
 *
 * Expone en `window` UN objeto plano y congelado, sin funciones ni acceso a
 * nada del sistema:
 *
 *   window.foranlyDesktop = {
 *     app: 'foranly-desktop',
 *     version: '0.1.0',
 *     platform: 'linux' | 'win32' | 'darwin',
 *     musicApiUrl: 'http://127.0.0.1:5990',  // base de /api/music/*
 *     musicReady: true,                      // el servidor local respondió
 *   }
 *
 * El cliente lo usa para (a) NO ofrecer la descarga a quien ya está en la app y
 * (b) resolver las canciones completas contra el loopback. La fuente de verdad
 * de esos datos es main.js: aquí solo se pregunta por IPC síncrono, así que no
 * hay copia de la configuración que se pueda desincronizar.
 *
 * Sin `contextBridge` la web remota vería el `window` aislado, así que este
 * archivo es la ÚNICA superficie expuesta — mantenerla mínima.
 */

const { contextBridge, ipcRenderer } = require('electron');

const BRIDGE_INFO_CHANNEL = 'foranly:desktop-info';

let info = null;
try {
  info = ipcRenderer.sendSync(BRIDGE_INFO_CHANNEL);
} catch {
  info = null; // sin puente la web se comporta como un navegador normal
}

if (info && typeof info === 'object') {
  contextBridge.exposeInMainWorld('foranlyDesktop', Object.freeze({ ...info }));
}
