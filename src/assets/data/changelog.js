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
    id: '2026-10-20',
    date: '2026-10-20',
    title: 'Floating player, chat dock and account settings',
    items: [
      'Your profile song now keeps playing while you browse, in a floating player you can drag anywhere on screen.',
      'A new chat dock keeps your recent conversations one click away, plus a floating chat window to reply without leaving the page.',
      'The Home tabs stay pinned to the top with a blurred background while you scroll the feed.',
      'In the desktop app, the title bar now shows your profile background instead of an opaque strip.',
      'Settings has a new Account section: change your username, email and password — every change asks for your current password first.',
      'Media and pinned messages in a chat are now available the moment you open the conversation.',
      'The "Pinned" badge on posts is now readable on light backgrounds.',
    ],
  },
  {
    id: '2026-10-16',
    date: '2026-10-16',
    title: 'Full songs in the desktop app',
    items: [
      'Profile songs play as a 30-second preview in the browser: YouTube only serves the full track to connections it trusts, and a server never qualifies.',
      'There is now a desktop app that resolves the song from your own connection, so it plays all the way through.',
      'New download page with the installer for your platform.',
      'You can now paste an image straight into a comment or reply with Ctrl+V.',
      'When you play a song in the browser, the app offers you the desktop version — you can dismiss it for good.',
    ],
  },
  {
    id: '2026-10-10+2',
    date: '2026-10-10',
    title: 'Your profile song, now streaming for real',
    items: [
      'The song you pin on your profile now plays the track itself, not only the 30-second preview.',
      'You can seek within the track while it streams.',
      'The audio is resolved inside the app itself, so it works the same in production and locally.',
        'If a song cannot be played in full, the card falls back to the preview automatically.',
    ],
  },
  {
    id: '2026-10-10',
    date: '2026-10-10',
    title: 'Markdown in posts',
    items: [
      'Posts now support markdown: bold, italic, strikethrough, inline code, lists, quotes, headings, tables and code blocks.',
      'A new formatting group in the composer toolbar inserts the syntax for you.',
      'Mentions and hashtags keep working inside formatted text.',
    ],
  },
  {
    id: '2026-08-24+2',
    date: '2026-08-24',
    title: 'Enhanced images, invitations, and statuses',
    items: [
      'Post images are now displayed with their actual aspect ratio, without cropping.',
      'The photos in the feed load an optimized version: less data, but the same quality when opened.',
      'Fixes in community invitations from the chat.',
      'More stable and accurate activity statuses (online / busy / away).',
      'The styles for Explore, communities, chats, and notifications were improved.',
      'The sidebar header adopts a specific style when navigating through chats.',
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
