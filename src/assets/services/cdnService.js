/**
 * FastChange CDN Service
 * Handles image uploads to the Go CDN server at api.foranly.space
 * Supports: avatar, banner, post, chat images
 *
 * Upload results are cached in sessionStorage by file fingerprint
 * (userId + type + file.name + file.size + file.lastModified) so that
 * re-uploading the same file returns instantly without a network request.
 */

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
function getCachedUpload(userId, type, file) {
  try {
    const key = getUploadCacheKey(userId, type, file);
    const cached = sessionStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    // Expire after 10 minutes so stale URLs eventually get refreshed
    if (Date.now() - parsed.timestamp > 10 * 60 * 1000) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.result;
  } catch {
    return null;
  }
}

/**
 * Save an upload result to the cache.
 */
function setCachedUpload(userId, type, file, result) {
  try {
    const key = getUploadCacheKey(userId, type, file);
    sessionStorage.setItem(key, JSON.stringify({
      result,
      timestamp: Date.now(),
    }));
  } catch {
    // sessionStorage might be full
  }
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
  const cached = getCachedUpload(userId, type, file);
  if (cached) {
    console.debug('⚡ CDN cache hit:', file.name);
    return cached;
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

  const result = {
    url: data.url,
    id: data.id,
    width: data.width,
    height: data.height,
    sizeKB: data.size_kb,
  };

  // Cache the result so re-uploading the same file is instant
  setCachedUpload(userId, type, file, result);

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
export function getCdnUrl(fileId) {
  if (!fileId) return '';
  if (fileId.startsWith('http://') || fileId.startsWith('https://')) return fileId;
  return `${CDN_BASE}/cdn/files/${fileId}`;
}

/**
 * Check if a URL is from our CDN.
 * @param {string} url
 * @returns {boolean}
 */
export function isCdnUrl(url) {
  if (!CDN_BASE) return false;
  return url?.startsWith(CDN_BASE) || false;
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
