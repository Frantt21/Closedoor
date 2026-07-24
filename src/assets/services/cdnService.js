/**
 * FastChange CDN Service
 * Handles image uploads to the Go CDN server at api.foranly.space
 * Supports: avatar, banner, post, chat images
 */

const CDN_BASE = import.meta.env.VITE_CDN_URL || 'http://api.foranly.space:24587';

/**
 * Upload an image to the CDN server.
 * @param {File} file - The image file to upload
 * @param {string} userId - The user's UUID
 * @param {'avatar'|'banner'|'post'|'chat'} type - Image type for sizing
 * @returns {Promise<{url: string, id: string, width?: number, height?: number}>}
 */
export async function uploadImage(file, userId, type) {
  if (!file || !userId || !type) {
    throw new Error('Missing required parameters: file, userId, type');
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

  return {
    url: data.url,
    id: data.id,
    width: data.width,
    height: data.height,
    sizeKB: data.size_kb,
  };
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
