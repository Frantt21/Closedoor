/**
 * appLogos.js — logos de marca (WebP) para la actividad de programa.
 *
 * FUENTE: apistemic logos (https://logos.apistemic.com). Es una API por DOMINIO
 * de empresa, sin clave ni registro: `https://logos-api.apistemic.com/domain:<dominio>`
 * devuelve WebP con `?format=webp&fallback=404` (404 si no hay logo, para que el
 * `<img>` dispare `onError` y podamos caer al icono local).
 *
 * POR QUÉ UN MAPA: lo que compartimos es un PROCESO (`brave.exe`, `Discord.exe`),
 * no un dominio. Este mapa traduce los programas conocidos a su dominio; lo que
 * no está listado no consulta la API y usa el icono real del ejecutable (en la
 * app de escritorio) o un icono genérico (en web).
 *
 * AVISO LEGAL: el uso gratuito exige atribución visible donde aparecen los logos
 * y un backlink en la home del sitio. El componente ProgramLogo no la pinta; la
 * añade cada sitio donde se usa (ver Settings y ActivityCard).
 *
 * El CSP de producción permite `img-src https:` (plugins/cspPlugin.js), así que
 * no hace falta tocar cabeceras.
 */

const LOGO_API = 'https://logos-api.apistemic.com';

/** Página del proveedor, para el enlace de atribución. */
export const APP_LOGO_CREDIT_URL = 'https://logos.apistemic.com';

/** Programa (nombre visible, en minúsculas) → dominio de la empresa. */
const APP_DOMAINS = {
  spotify: 'spotify.com',
  discord: 'discord.com',
  steam: 'steamcommunity.com',
  brave: 'brave.com',
  telegram: 'telegram.org',
  whatsapp: 'whatsapp.com',
  slack: 'slack.com',
  figma: 'figma.com',
  notion: 'notion.so',
  zoom: 'zoom.us',
  twitch: 'twitch.tv',
  roblox: 'roblox.com',
  'obs studio': 'obsproject.com',
  obs: 'obsproject.com',
  'vs code': 'code.visualstudio.com',
  'visual studio code': 'code.visualstudio.com',
  'github desktop': 'github.com',
  'epic games launcher': 'epicgames.com',
  'amd radeon software': 'amd.com',
  'windows terminal': 'microsoft.com',
  // Navegadores: la API da el logo de la EMPRESA, no el del producto.
  chrome: 'google.com',
  'google chrome': 'google.com',
  firefox: 'mozilla.org',
  edge: 'microsoft.com',
  'microsoft edge': 'microsoft.com',
};

/**
 * Dominio asociado a un programa compartido, o null si no lo conocemos.
 *
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
export function appLogoDomain(title) {
  const key = String(title || '').trim().toLowerCase();
  if (!key) return null;
  return APP_DOMAINS[key] || null;
}

/**
 * URL del logo WebP, o null si el programa no tiene dominio mapeado.
 *
 * `fallback=404` es deliberado: sin logo preferimos el icono local antes que un
 * monograma con la inicial.
 *
 * @param {string|null|undefined} title
 * @returns {string|null}
 */
export function appLogoUrl(title) {
  const domain = appLogoDomain(title);
  if (!domain) return null;
  return `${LOGO_API}/domain:${domain}?format=webp&fallback=404`;
}
