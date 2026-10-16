/**
 * deployWatcher.js — detecta un build NUEVO desplegado en el servidor.
 *
 * CONTEXTO: la web (y la app de escritorio, que carga esta misma web publicada)
 * se actualiza al desplegar. Con la pestaña abierta, el usuario sigue con el
 * bundle viejo hasta que recarga. Este módulo compara el `build-id` del HTML
 * actual con el que sirve `/version.json` (lo escribe plugins/buildIdPlugin.js)
 * y, si cambia, avisa para que el usuario recargue.
 *
 * Reglas:
 *   - Solo en producción (`import.meta.env.PROD`): en dev no hay version.json.
 *   - Sin red / sin endpoint → no hace nada (nunca lanza).
 *   - Avisa UNA sola vez por carga de página.
 *   - Comprueba al recuperar el foco, al volver visible la pestaña y cada
 *     POLL_INTERVAL_MS. No sondea mientras la pestaña está oculta.
 */

/** Evento (window) que abre el aviso de "recarga para actualizar". */
export const DEPLOY_UPDATE_EVENT = 'fc:deploy-update';

const VERSION_URL = '/version.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const FIRST_CHECK_DELAY_MS = 15000; // no competir con el arranque

function getCurrentBuildId() {
  try {
    return document.querySelector('meta[name="build-id"]')?.getAttribute('content') || '';
  } catch {
    return '';
  }
}

/** `build-id` que sirve el servidor ahora mismo ('' si no se puede saber). */
async function fetchDeployedBuildId() {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return typeof data?.buildId === 'string' ? data.buildId : '';
  } catch {
    return '';
  }
}

let started = false;

/** Arranca el vigilante. Idempotente. */
export function startDeployWatcher() {
  if (started || typeof window === 'undefined') return;
  if (!import.meta.env.PROD) return;

  const current = getCurrentBuildId();
  if (!current) return; // sin meta no hay con qué comparar (build local antiguo)
  started = true;

  let notified = false;

  const check = async () => {
    if (notified) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const deployed = await fetchDeployedBuildId();
    if (!deployed || deployed === current) return;
    notified = true;
    try {
      window.dispatchEvent(new CustomEvent(DEPLOY_UPDATE_EVENT));
    } catch {
      /* CustomEvent no disponible: se ignora */
    }
  };

  setInterval(check, POLL_INTERVAL_MS);

  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  setTimeout(check, FIRST_CHECK_DELAY_MS);
}
