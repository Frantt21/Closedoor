/**
 * desktopApp.js — detección de la app de escritorio (Electron) y aviso de descarga.
 *
 * CONTEXTO: YouTube solo entrega el stream completo a IPs con buena reputación;
 * desde un datacenter falla. La web no puede resolver eso desde el navegador, así
 * que la canción completa se ofrece en la app de escritorio
 * (desktop/main.js), que levanta el servidor de música del repo en
 * 127.0.0.1:5990 — misma lógica que producción, pero saliendo por la conexión del
 * usuario. Ver desktop/README.md.
 *
 * Este módulo es la ÚNICA fuente de verdad en el cliente para:
 *   1. Saber si estamos dentro de esa app (`window.foranlyDesktop`, que publica
 *      desktop/preload.js por contextBridge).
 *   2. Decidir a qué base apuntan las peticiones de /api/music/* (loopback propia
 *      o mismo origen).
 *   3. Decidir si toca mostrar el aviso "descarga la app para oírla completa".
 *
 * El aviso se comporta como el modal de changelog: la ✗ lo cierra SIN recordar
 * nada (vuelve a salir en la próxima carga) y "no volver a mostrar" lo descarta
 * para siempre (localStorage).
 */

/** Evento (window) que pide abrir el aviso. Lo escucha DesktopAppPrompt.jsx. */
export const DESKTOP_PROMPT_EVENT = 'fc:desktop-prompt';

/** localStorage: '1' = el usuario pidió no volver a ver el aviso. */
export const DESKTOP_PROMPT_DISMISSED_KEY = 'fc_desktop_prompt_dismissed';

/**
 * Datos publicados por el preload de la app de escritorio.
 * `null` en cualquier navegador (o si el puente no llegó a cargar).
 */
export function getDesktopBridge() {
  try {
    const bridge = window.foranlyDesktop;
    return bridge && typeof bridge === 'object' ? bridge : null;
  } catch {
    return null;
  }
}

/** ¿Estamos dentro de la app de escritorio? */
export function isDesktopApp() {
  return !!getDesktopBridge();
}

/**
 * Base de `/api/music/*` para las peticiones de reproducción.
 * - App de escritorio con el servidor local vivo → `http://127.0.0.1:5990/api/music`
 *   (el audio sale por la IP del usuario; la URL firmada coincide con quien pide).
 * - Cualquier otro caso → `/api/music` mismo-origen (rewrite de Vercel o el
 *   plugin de dev), y si el stream falla la card cae al preview de 30 s.
 *
 * Se evalúa EN CADA LLAMADA (no se cachea en un const): la app de escritorio
 * puede arrancar el servidor después de que el bundle se haya cargado.
 */
export function getMusicApiBase() {
  const bridge = getDesktopBridge();
  const origin = typeof bridge?.musicApiUrl === 'string' ? bridge.musicApiUrl.trim().replace(/\/+$/, '') : '';
  if (!origin || bridge?.musicReady === false) return '/api/music';
  return `${origin}/api/music`;
}

/** ¿El usuario pidió no volver a ver el aviso? (persistente, por navegador) */
export function isDesktopPromptDismissed() {
  try {
    return localStorage.getItem(DESKTOP_PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false; // storage bloqueado → se comporta como no descartado
  }
}

/** Descarta el aviso para siempre (botón "No volver a mostrar"). */
export function dismissDesktopPrompt() {
  try {
    localStorage.setItem(DESKTOP_PROMPT_DISMISSED_KEY, '1');
  } catch {
    // storage bloqueado → solo se cierra esta vez
  }
}

/**
 * Permite volver a ver el aviso tras descartarlo (por si algún día hace falta
 * un botón de "activar avisos" en Ajustes).
 */
export function resetDesktopPromptDismissal() {
  try {
    localStorage.removeItem(DESKTOP_PROMPT_DISMISSED_KEY);
  } catch {
    // storage bloqueado: nada que limpiar
  }
}

// Una vez por carga de página: el aviso no debe reaparecer cada vez que el
// usuario le da a play (ni al cambiar de canción ni entre perfiles).
let promptedThisSession = false;

/**
 * El usuario acaba de empezar a reproducir una canción EN EL NAVEGADOR.
 * Dispara el aviso si procede y devuelve si lo hizo.
 *
 * No se dispara si: ya estamos en la app de escritorio (ahí la canción suena
 * completa), el usuario lo descartó, o ya se avisó en esta carga.
 */
export function notifyBrowserPlayback() {
  if (isDesktopApp() || promptedThisSession || isDesktopPromptDismissed()) return false;
  promptedThisSession = true;
  try {
    window.dispatchEvent(new CustomEvent(DESKTOP_PROMPT_EVENT));
    return true;
  } catch {
    return false;
  }
}
