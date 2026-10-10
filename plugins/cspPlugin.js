/**
 * CSP Plugin — Content-Security-Policy estricta (solo build de producción)
 *
 * Inyecta un <meta http-equiv="Content-Security-Policy"> en el HTML del build
 * para que la política viaje en TODOS los hosts donde se sirva el bundle
 * (Vercel, server.js self-hosted, túneles) sin depender de headers HTTP.
 *
 * - apply: 'build' → en `vite dev` NO aplica (HMR necesita scripts inline
 *   y WebSocket de Vite; una CSP ahí rompería el dev server).
 * - Sin 'unsafe-eval' ni 'unsafe-inline' en script-src: el código de la app
 *   no usa eval/new Function, así que la protección contra XSS es real.
 * - style-src 'unsafe-inline' es OBLIGATORIO: inlineCssPlugin mete el CSS
 *   inline en el HTML y React usa style={{}} (no hay nonce viable aquí).
 * - La canción del perfil se sirve same-origin (/api/music/stream), así que 'self'
 *   ya la cubre: no hace falta ningún host de música ni túnel en connect-src.
 *   LiveKit Cloud → *.livekit.cloud.
 *
 * ⚠️ MANTENER CONSISTENTE con la cabecera HTTP de vercel.json (la versión
 * HTTP añade frame-ancestors 'none', que la meta tag no soporta).
 */

// ── Construir la política desde el entorno real ──
function buildCSP() {
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    process.env.VITE_SUPABASE_DATA_API_URL ||
    '';
  const cdnUrl = process.env.VITE_CDN_URL || '';

  let supabaseOrigin = '';
  try { supabaseOrigin = new URL(supabaseUrl).origin; } catch {}
  const supabaseWss = supabaseOrigin ? `wss://${new URL(supabaseOrigin).host}` : '';

  let cdnOrigin = '';
  try { cdnOrigin = new URL(cdnUrl).origin; } catch {}
  // El CDN también se consume same-origin vía rewrite /cdn/* (Vercel) y
  // proxy (vite dev), así que 'self' ya lo cubre; el origin explícito
  // cubre el caso en que VITE_CDN_URL apunte directo al servidor.

  const connect = [
    "'self'",
    supabaseOrigin, supabaseWss,
    cdnOrigin,
    // Búsqueda de música: iTunes directo desde el navegador (los previews de
    // Deezer van por el proxy same-origin /api/music-search).
    'https://itunes.apple.com',
    'https://api.klipy.com',
    'https://challenges.cloudflare.com',
    // LiveKit Cloud (el server devuelve la URL real en /api/livekit-token)
    'https://*.livekit.cloud', 'wss://*.livekit.cloud',
  ].filter(Boolean);

  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://player.vimeo.com",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function cspPlugin() {
  return {
    name: 'inject-csp',
    apply: 'build', // SOLO build de producción; dev sin CSP (HMR)
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: buildCSP(),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// Reutilizable si algún día se genera la política dinámicamente en server.js
export { buildCSP };
