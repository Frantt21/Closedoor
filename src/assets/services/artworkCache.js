/**
 * artworkCache — estado cacheado de la miniatura de una canción.
 *
 * POR QUÉ EXISTE
 * Las portadas de una canción NO cambian: una URL que carga una vez (o una que
 * falla) va a comportarse igual en el siguiente montaje. Aun así, la tarjeta
 * del chat, el buscador, la card del perfil y el mini reproductor se montan y
 * desmontan continuamente, y cada montaje repetía la cadena de intentos
 * (URL directa → /api/image-proxy → placeholder). Aquí ese resultado se
 * persiste para no volver a pedir nada:
 *
 *   'direct' → la URL original carga; se usa tal cual
 *   'proxy'  → la original falló y la que funciona es /api/image-proxy
 *   'failed' → ninguna de las dos cargó; se pinta el icono sin hacer peticiones
 *
 * CUÁNDO SE INVALIDA
 * Solo cuando cambia la portada de esa canción: la entrada guarda la `src` a la
 * que corresponde y se ignora si la URL actual es otra (otra portada = otra
 * entrada). No hay TTL ni limpieza periódica a propósito; `clearArtworkCache`
 * existe para forzar un reintento manual.
 *
 * Se usa localStorage directo (no secureStorage): aquí solo viaja una URL
 * pública y un modo de tres valores, y fue escrito menos sensible que una
 * sesión; además la lectura síncrona está disponible en el primer render,
 * antes de que secureStorage termine de calentar la clave.
 */

const PREFIX = 'fc_artwork_v1_';

/** Identificador estable de la miniatura: canción + URL resuelta. */
export function artworkCacheId(song, src) {
  const id = song?.provider && song?.trackId ? `${song.provider}:${song.trackId}` : src;
  return `${PREFIX}${id || ''}`;
}

/**
 * Modo cacheado para esta miniatura. Devuelve 'direct' si no hay entrada o si
 * la entrada pertenece a otra URL (la portada cambió).
 * @returns {'direct'|'proxy'|'failed'}
 */
export function getArtworkMode(song, src) {
  if (!src) return 'direct';
  try {
    const raw = localStorage.getItem(artworkCacheId(song, src));
    if (!raw) return 'direct';
    const entry = JSON.parse(raw);
    if (!entry || entry.src !== src) return 'direct';
    return entry.mode === 'proxy' || entry.mode === 'failed' ? entry.mode : 'direct';
  } catch {
    return 'direct';
  }
}

/** Guarda el modo resuelto para esta miniatura (sin caducidad). */
export function setArtworkMode(song, src, mode) {
  if (!src || !mode) return;
  try {
    localStorage.setItem(
      artworkCacheId(song, src),
      JSON.stringify({ src, mode, ts: Date.now() })
    );
  } catch {
    // localStorage lleno o bloqueado: se pierde la optimización, no la imagen
  }
}

/** Olvida el estado cacheado de esta miniatura (próximo montaje reintenta). */
export function clearArtworkCache(song, src) {
  if (!src) return;
  try {
    localStorage.removeItem(artworkCacheId(song, src));
  } catch {
    // Ignore
  }
}
