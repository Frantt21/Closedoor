// ── Whitelist de proveedores de correo permitidos ──
// Módulo PURAMENTE lógico (cero imports): se puede importar desde el browser
// y desde Node (scripts/test-security-full.mjs en CI) sin dependencias
// browser-only. userService.js re-exporta estas funciones para la app.
//
// Como la verificación de email está deshabilitada en Supabase, cualquiera
// podría registrarse con un correo falso/desechable. Se restringe el registro
// (y el login) a proveedores conocidos para reducir cuentas basura.
export const ALLOWED_EMAIL_DOMAINS = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft (Outlook/Hotmail/Live) + variantes regionales
  'outlook.com',
  'outlook.es',
  'outlook.com.ar',
  'outlook.com.br',
  'outlook.com.mx',
  'hotmail.com',
  'hotmail.es',
  'hotmail.com.br',
  'hotmail.co.uk',
  'hotmail.fr',
  'live.com',
  'live.com.ar',
  'live.com.br',
  'live.com.mx',
  // Yahoo + variantes regionales
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.com.mx',
  'yahoo.com.es',
  'yahoo.com.br',
  'yahoo.co.uk',
  'yahoo.ca',
  'yahoo.co.in',
  // Proton
  'proton.me',
  'protonmail.com',
  // Apple
  'icloud.com',
  'me.com',
]);

export const ALLOWED_EMAIL_DOMAINS_LIST = [...ALLOWED_EMAIL_DOMAINS].sort();

/**
 * Extrae el dominio de un email (minúsculas, sin espacios).
 * @returns {string|null} dominio o null si no parece un email
 */
export function getEmailDomain(email) {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

/**
 * Valida formato básico de email (regex estándar, no perfecto pero
 * suficiente para el registro).
 */
export function isValidEmailFormat(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

/**
 * ¿El dominio del email está en la whitelist?
 */
export function isAllowedEmailDomain(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

/**
 * Validación completa de email para registro/login.
 * @returns {string|null} - 'invalid' | 'domain' | null (válido)
 */
export function validateEmail(email) {
  if (!isValidEmailFormat(email)) return 'invalid';
  if (!isAllowedEmailDomain(email)) return 'domain';
  return null;
}
