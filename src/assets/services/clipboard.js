/**
 * clipboard.js — leer imágenes pegadas (Ctrl+V) desde el portapapeles.
 *
 * Pegar una captura es el camino natural para adjuntar imágenes, y el patrón se
 * repetía en tres sitios (comentarios, chat y crear post). Vive aquí para que la
 * regla sea la misma en todos:
 *
 *   - Solo se responde a `kind: 'file'` con MIME de imagen → si el portapapeles
 *     trae TEXTO, esto devuelve null y quien llama DEJA el pegado por defecto
 *     (no hay que llamar a preventDefault en ese caso).
 *   - Un item sin `getAsFile()` (algunos navegadores dejan items fantasma) no
 *     aborta la búsqueda: se sigue con los demás.
 */

const IMAGE_MIME_RE = /^image\//i;

/**
 * @param {DataTransfer|null|undefined} clipboardData — el de un evento `paste`
 * @returns {File|null} el primer archivo de imagen, o null si lo pegado no es una imagen
 */
export function getClipboardImageFile(clipboardData) {
  const items = clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item?.kind !== 'file') continue;
    if (!IMAGE_MIME_RE.test(item.type || '')) continue;
    const file = item.getAsFile?.();
    if (file) return file; // item sin File → seguir con los demás
  }

  return null;
}
