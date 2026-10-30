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
 * useLocalActivity — actividad local del equipo (música, vídeo o juego) según la
 * detecta la app de escritorio (desktop/activity.js) y publica preload.js.
 *
 * En el navegador `window.electron.activity` no existe, así que el hook devuelve
 * siempre `null` y no registra nada: el mismo componente sirve en web y en
 * escritorio sin ramas extra.
 *
 * @returns {null | {kind: 'music'|'video'|'game', title: string, subtitle: string|null, album: string|null, app: string|null, url: string|null, detectedAt: string}}
 */
export function useLocalActivity() {
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    // El API solo existe dentro de la app de escritorio (preload.js).
    const api = typeof window !== 'undefined' ? window.electron?.activity : null;
    if (!api || typeof api.subscribe !== 'function') return undefined;

    let alive = true;

    // Estado inicial por invoke; si falla, se queda en null (sin actividad).
    Promise.resolve()
      .then(() => api.get())
      .then((value) => {
        if (alive) setActivity(value || null);
      })
      .catch(() => {
        if (alive) setActivity(null);
      });

    // La app avisa solo cuando la actividad cambia de verdad.
    const unsubscribe = api.subscribe((value) => setActivity(value || null));

    return () => {
      alive = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  return activity;
}
