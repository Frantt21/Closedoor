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
