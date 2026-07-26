/**
 * FastChange CDN Service
 * Handles image uploads to the Go CDN server at api.foranly.space
 * Supports: avatar, banner, post, chat images
 *
 * Upload results are cached in encrypted localStorage by file fingerprint
 * (userId + type + file.name + file.size + file.lastModified) so that
 * re-uploading the same file returns instantly without a network request.
 *
 * Cache: permanente. El backend CDN usa dedup por hash, así que las URLs
 * cacheadas NUNCA se vuelven obsoletas. Cada entrada ocupa ~300 bytes en
 * encrypted localStorage — caben miles antes de llenar la cuota (~5MB).
 */

import { getItem, setItem, removeItem } from './secureStorage';

const CDN_BASE = import.meta.env.VITE_CDN_URL || '';
const CACHE_PREFIX = 'cdn_upload_';

/**
 * Generate a cache key for the upload result.
 * Uniquely identifies a file by its name, size, and lastModified timestamp,
 * scoped to the user and upload type.
 */
function getUploadCacheKey(userId, type, file) {
  return `${CACHE_PREFIX}${userId}_${type}_${file.name}_${file.size}_${file.lastModified}`;
}

/**
 * Try to get a cached upload result for the given file.
 * Returns the cached result or null if not found/expired.
 */
async function getCachedUpload(userId, type, file) {
  try {
    const key = getUploadCacheKey(userId, type, file);
    const parsed = await getItem(key);
    if (!parsed) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

/**
 * Save an upload result to the cache.
 */
async function setCachedUpload(userId, type, file, result) {
  try {
    const key = getUploadCacheKey(userId, type, file);
    await setItem(key, {
      result,
      timestamp: Date.now(),
    });
  } catch {
    // localStorage might be full
  }
}

/**
 * Upload an image to the CDN server with optimistic local preview.
 * Creates a blob:// URL from the file instantly for immediate display,
 * then uploads to CDN in the background.
 *
 * @param {File} file - The image file to upload
 * @param {string} userId - The user's UUID
 * @param {'avatar'|'banner'|'post'|'chat'} type - Image type for sizing
 * @returns {Promise<{localUrl: string, realUrlPromise: Promise<string>}>}
 *
 * Usage:
 *   const { localUrl, realUrlPromise } = uploadWithLocalPreview(file, userId, type);
 *   setPreview(localUrl);           // show instantly
 *   const realUrl = await realUrlPromise;  // wait for CDN in background
 *   setPreview(realUrl);            // swap with real URL
 */
export function uploadWithLocalPreview(file, userId, type) {
  // Create local object URL instantly for preview
  const localUrl = URL.createObjectURL(file);

  // Start CDN upload in background
  const realUrlPromise = uploadImage(file, userId, type)
    .then(result => {
      // ⚠️ Delayed cleanup: esperar a que React commitée la URL real
      // antes de revocar el blob URL, para evitar ERR_FILE_NOT_FOUND
      // en <img> que todavía apuntan al blob.
      requestAnimationFrame(() => URL.revokeObjectURL(localUrl));
      return result.url;
    })
    .catch(err => {
      // Clean up on error: el blob ya no sirve
      URL.revokeObjectURL(localUrl);
      throw err;
    });

  return { localUrl, realUrlPromise };
}

/**
 * Upload an image to the CDN server.
 * Results are cached by file fingerprint — re-uploading the same file returns
 * the cached URL immediately without a network request.
 * @param {File} file - The image file to upload
 * @param {string} userId - The user's UUID
 * @param {'avatar'|'banner'|'post'|'chat'} type - Image type for sizing
 * @returns {Promise<{url: string, id: string, width?: number, height?: number}>}
 */
export async function uploadImage(file, userId, type) {
  if (!file || !userId || !type) {
    throw new Error('Missing required parameters: file, userId, type');
  }

  // ── Check local cache first (instant return for re-uploads) ──
  const cached = await getCachedUpload(userId, type, file);
  if (cached) {
    console.debug('⚡ CDN cache hit:', file.name);
    // Normalizar URLs cacheadas de sesiones anteriores (forceHttps → relativa)
    return { ...cached, url: normalizeCdnUrl(cached.url) };
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Allowed: JPEG, PNG, GIF, WebP`);
  }

  // Validate file size (max 20MB)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 20MB`);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('user_id', userId);
  formData.append('type', type);

  const response = await fetch(`${CDN_BASE}/cdn/upload`, {
    method: 'POST',
    body: formData,
    // No Content-Type header - browser sets it with boundary for FormData
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Upload failed');
  }

  // Si el CDN devolvió url (nueva subida) la normalizamos a ruta relativa.
  // Si no (dedup hit: el CDN reusó un archivo existente y solo devolvió el id),
  // construimos la URL relativa desde el id.
  const result = {
    url: data.url ? normalizeCdnUrl(data.url) : `/cdn/files/${data.id}`,
    id: data.id,
    width: data.width,
    height: data.height,
    sizeKB: data.size_kb,
  };

  // Cache the result so re-uploading the same file is instant
  setCachedUpload(userId, type, file, result).catch(() => {});

  return result;
}

/**
 * Delete an image from the CDN server.
 * @param {string} imageId - The image UUID
 * @returns {Promise<boolean>}
 */
export async function deleteImage(imageId) {
  if (!imageId) return false;

  try {
    const response = await fetch(`${CDN_BASE}/cdn/files/${imageId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    return data.success === true;
  } catch (err) {
    console.warn('Error deleting image from CDN:', err);
    return false;
  }
}

/**
 * Get the full CDN URL for a file ID.
 * @param {string} fileId - The file UUID
 * @returns {string}
 */
/**
 * Convert a CDN URL to a same-origin relative path so the browser loads it
 * through the Vite proxy (dev) or Vercel rewrites (production) instead of
 * hitting the HTTP-only CDN server directly over HTTPS.
 *
 *   http://api.foranly.space:24587/cdn/files/xxx → /cdn/files/xxx
 *
 * ⚠️ SIEMPRE devuelve un string (nunca undefined/null) para evitar que
 *    componentes llamen .trim() sobre undefined y lancen TypeError.
 */
export function normalizeCdnUrl(url) {
  if (!url) return ''; // ← devolver '' en vez del valor falsy
  // Si es una URL absoluta HTTP/HTTPS, extraer solo el path relativo
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    // No es una URL parseable → probablemente ya es relativa o un ID
    return url;
  }
}

/**
 * Get the CDN URL for a file ID, always returning a same-origin relative path.
 * Úsala en TODOS los componentes que rendericen imágenes del CDN para
 * garantizar que nunca se cargue una URL HTTP directa (previene Mixed Content).
 *
 * ⚠️ IMPORTANTE: Solo normaliza URLs que sean realmente del CDN.
 * URLs externas (Pinterest, GIPHY, Tenor, etc.) se devuelven intactas.
 *
 * @param {string} fileId - The file UUID, full URL, or relative path
 * @returns {string} - Relative path like "/cdn/files/xxx" or the original URL
 */
export function getCdnUrl(fileId) {
  if (!fileId) return '';

  // Si NO es URL del CDN, devolver tal cual (imágenes externas: Pinterest, GIPHY, etc.)
  if (!isCdnUrl(fileId)) return fileId;

  // Es URL del CDN → normalizar a ruta relativa
  if (fileId.startsWith('http://') || fileId.startsWith('https://')) {
    const normalized = normalizeCdnUrl(fileId);
    if (normalized.startsWith('/cdn/')) return normalized;
    // Si normalizeCdnUrl devolvió algo inesperado, reconstruir desde el ID
    return `/cdn/files/${fileId.split('/').pop()}`;
  }
  // Si ya es /cdn/files/xxx, devolver tal cual
  if (fileId.startsWith('/cdn/')) return fileId;
  // Es solo un ID → construir ruta completa
  return `/cdn/files/${fileId}`;
}

/**
 * Check if a URL is from our CDN.
 * Reconoce rutas relativas (/cdn/files/xxx), URLs del CDN_BASE configurado,
 * y URLs absolutas con path /cdn/ (ej: http://api.foranly.space:24587/cdn/files/xxx).
 * @param {string} url
 * @returns {boolean}
 */
export function isCdnUrl(url) {
  if (!url) return false;
  // Relativa: /cdn/files/xxx
  if (url.startsWith('/cdn/')) return true;
  // Desde VITE_CDN_URL (si está configurado)
  if (CDN_BASE && url.startsWith(CDN_BASE)) return true;
  // URLs absolutas con /cdn/ en el path (backend devuelve http://api.foranly.space:24587/cdn/files/xxx)
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/cdn/')) return true;
  } catch {
    // No se puede parsear como URL — no es CDN
  }
  return false;
}

/**
 * Extract file ID from a CDN URL.
 * @param {string} url
 * @returns {string|null}
 */
export function getFileIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/cdn\/files\/([^/?#]+)/);
  return match ? match[1] : null;
}
