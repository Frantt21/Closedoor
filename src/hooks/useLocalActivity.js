import { useEffect, useState } from 'react';

/**
 * ¿Está disponible la detección local? Solo dentro de la app de escritorio
 * (desktop/preload.js publica `window.electron.activity`).
 *
 * Sirve para distinguir "no hay nada activo" de "aquí no se puede detectar":
 * en el navegador el hook devuelve null siempre, y quien lo consuma debe caer al
 * dato guardado en la base de datos en vez de asumir que el usuario está parado.
 */
export function isLocalActivityAvailable() {
  try {
    const api = typeof window !== 'undefined' ? window.electron?.activity : null;
    return !!api && typeof api.subscribe === 'function';
  } catch {
    return false;
  }
}

/**
 * ¿El preload instalado ya expone el listado de programas?
 *
 * Importa para distinguir "no hay nada abierto" de " esta app de escritorio es
 * anterior a la función": sin esto el selector aparece vacío y parece roto hasta
 * reiniciar la app para cargar el preload nuevo.
 */
export function isOpenAppsAvailable() {
  try {
    const api = typeof window !== 'undefined' ? window.electron?.activity : null;
    return !!api && typeof api.listApps === 'function';
  } catch {
    return false;
  }
}

/**
 * Programas abiertos en el equipo (Ajustes → Actividad).
 *
 * Bajo demanda y no con un hook: la lista se pide al abrir la categoría y al
 * pulsar "actualizar", no cada 10 s como la actividad. En el navegador devuelve
 * [] porque no hay puente.
 *
 * @returns {Promise<Array<{name: string, exe: string, icon: string|null}>>}
 */
export async function listOpenApps() {
  try {
    const api = typeof window !== 'undefined' ? window.electron?.activity : null;
    if (!api || typeof api.listApps !== 'function') return [];
    const apps = await api.listApps();
    if (!Array.isArray(apps)) return [];
    return apps
      .map((item) => {
        if (typeof item === 'string') return { name: item, exe: item, icon: null };
        const name = typeof item?.name === 'string' ? item.name : '';
        if (!name) return null;
        // El icono llega como data URL del ejecutable (main.js → getFileIcon).
        // Se valida el prefijo para no pintar cualquier cosa que mande el puente.
        const icon = typeof item.icon === 'string' && item.icon.startsWith('data:image/') ? item.icon : null;
        return { name, exe: typeof item.exe === 'string' && item.exe ? item.exe : name, icon };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * useLocalActivityState — actividad local del equipo (música, vídeo o juego) según
 * la detecta la app de escritorio (desktop/activity.js) y publica preload.js.
 *
 * Devuelve `{ activity, ready }`:
 *   · `activity` — objeto normalizado o null si no hay nada activo.
 *   · `ready`    — se puso true cuando llegó la PRIMERA lectura. Importante para
 *                  quien reaccione a los cambios: el `null` inicial es "todavía
 *                  no lo sé", no "dejó de sonar".
 *
 * En el navegador no hay puente, así que se queda en `{ activity: null, ready:
 * false }` y no registra nada: el mismo componente sirve en web y escritorio.
 *
 * @returns {{activity: null | {kind: 'music'|'video'|'game', title: string, subtitle: string|null, album: string|null, app: string|null, url: string|null, detectedAt: string}, ready: boolean}}
 */
export function useLocalActivityState() {
  const [state, setState] = useState({ activity: null, ready: false });

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electron?.activity : null;
    if (!api || typeof api.subscribe !== 'function') return undefined;

    let alive = true;

    // Estado inicial por invoke; si falla, queda en null pero marcado como listo
    // (si no, el consumidor esperaría para siempre).
    Promise.resolve()
      .then(() => api.get())
      .then((value) => {
        if (alive) setState({ activity: value || null, ready: true });
      })
      .catch(() => {
        if (alive) setState({ activity: null, ready: true });
      });

    // La app avisa solo cuando la actividad cambia de verdad.
    const unsubscribe = api.subscribe((value) => {
      if (alive) setState({ activity: value || null, ready: true });
    });

    return () => {
      alive = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Atajo cuando solo interesa el valor y no si ya llegó la primera lectura.
 * En el navegador devuelve siempre null.
 */
export function useLocalActivity() {
  return useLocalActivityState().activity;
}
