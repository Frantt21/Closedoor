/**
 * changelog — Novedades mostradas a los usuarios tras cada deploy.
 *
 * CÓMO FUNCIONA:
 * - Cada entrada representa un deploy con cambios visibles para usuarios.
 * - Al cargar la app en PRODUCCIÓN, si el id de la primera entrada difiere
 *   del último visto (localStorage 'fc_changelog_seen'), se muestra el modal.
 * - El botón de aceptar guarda el id → no vuelve a mostrarse.
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
    id: '2026-08-24',
    date: '2026-08-24',
    title: 'Enhanced images, invitations, and statuses',
    items: [
      'Post images are now displayed with their actual aspect ratio, without cropping.',
      'The photos in the feed load an optimized version: less data, but the same quality when opened.',
      'Fixes in community invitations from the chat.',
      'More stable and accurate activity statuses (online / busy / away).',
    ],
  },
];
