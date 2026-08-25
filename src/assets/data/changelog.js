/**
 * changelog — Novedades mostradas a los usuarios tras cada deploy.
 *
 * CÓMO FUNCIONA:
 * - Cada entrada representa un deploy con cambios visibles para usuarios.
 * - La visibilidad NO depende solo del id: se guarda un fingerprint
 *   `id:hash-contenido` (getReleaseFingerprint). El popup reaparece si el id
 *   es nuevo O si editas el contenido de una entrada ya publicada.
 * - hasSeenRelease() valida el fingerprint contra 'fc_changelog_seen' → si
 *   difiere, se ignora lo guardado y se muestra el modal de nuevo.
 * - Un deploy SIN entrada nueva NO muestra nada (evita popups vacíos).
 *
 * FORMATO:
 *   id:    identificador único (fecha o versión) — cambiarlo dispara el popup
 *   date:  'YYYY-MM-DD'
 *   title: título del release
 *   items: lista de novedades (texto plano; el usuario las ve como bullets)
 *
 * ⚠️ NUEVA ENTRADA SIEMPRE ARRIBA del array.
 */
export const CHANGELOG_SEEN_KEY = 'fc_changelog_seen';

export const RELEASES = [
  {
    id: '2026-08-24+2',
    date: '2026-08-24',
    title: 'Enhanced images, invitations, and statuses',
    items: [
      'Post images are now displayed with their actual aspect ratio, without cropping.',
      'The photos in the feed load an optimized version: less data, but the same quality when opened.',
      'Fixes in community invitations from the chat.',
      'More stable and accurate activity statuses (online / busy / away).',
      'The styles for Explore, communities, and notifications were improved.',
    ],
  },
];

/**
 * Hash FNV-1a corto del contenido del release. No es criptográfico: solo
 * sirve para detectar que el contenido cambió y invalidar cachés.
 */
function hashRelease(entry) {
  const str = JSON.stringify([entry.id, entry.title, entry.items]);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Fingerprint del release actual ('id:hash'). null si no hay entradas. */
export function getReleaseFingerprint(entry = RELEASES[0]) {
  if (!entry) return null;
  return `${entry.id}:${hashRelease(entry)}`;
}

/** ¿El usuario ya vio ESTA versión exacta del último release? */
export function hasSeenRelease() {
  try {
    const fp = getReleaseFingerprint();
    return !!fp && localStorage.getItem(CHANGELOG_SEEN_KEY) === fp;
  } catch {
    // localStorage bloqueado → no sabemos; mejor mostrar el popup
    return false;
  }
}

/** Marca como visto guardando el fingerprint (id + hash de contenido). */
export function markReleaseSeen() {
  try {
    const fp = getReleaseFingerprint();
    if (fp) localStorage.setItem(CHANGELOG_SEEN_KEY, fp);
  } catch {
    // localStorage bloqueado → solo cerrar; reaparecerá al recargar
  }
}
