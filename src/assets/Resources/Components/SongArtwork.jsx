import { useEffect, useState } from 'react';
import { FaMusic } from 'react-icons/fa';
import { songArtworkUrl, proxiedArtworkUrl } from '../../services/musicService';
import { artworkCacheId, getArtworkMode, setArtworkMode } from '../../services/artworkCache';

/**
 * SongArtwork — miniatura de una canción para las cards del chat, el buscador,
 * la card del perfil y el mini reproductor. Las cuatro pintan el MISMO `song`,
 * así que comparten la misma resolución de URL y el mismo respaldo; antes cada
 * una hacía su propio `<img src={song.artwork} onError={hide}>` y, si el CDN no
 * respondía, dejaba un hueco vacío sin explicación.
 *
 * Orden de intentos (y su CACHÉ, ver services/artworkCache):
 *   1. La URL del campo `artwork` (o derivada del videoId — songArtworkUrl).
 *   2. La misma imagen por `/api/image-proxy` (same-origin): cubre redes/DNS
 *      que bloquean el CDN, hotlink y CSP antiguas.
 *   3. El icono de música, que es el placeholder ya estilizado de cada card.
 *
 * El resultado se persiste por canción: una portada no cambia, así que una
 * tarjeta que se desmonta y vuelve a montarse arranca directamente en el modo
 * ya resuelto (directo, proxy o icono) sin repetir peticiones. Solo cambia si
 * cambia la URL de la portada de esa canción.
 */
export default function SongArtwork({
  song,
  className,
  emptyClassName,
  alt = '',
  ...imgProps
}) {
  const src = songArtworkUrl(song);
  const cacheId = artworkCacheId(song, src);
  const [mode, setMode] = useState(() => getArtworkMode(song, src));

  // Al cambiar de canción (o de portada) se relee el modo cacheado de esa nueva
  // miniatura; si no hay entrada, se empieza por la URL directa.
  useEffect(() => {
    setMode(getArtworkMode(song, src));
    // cacheId ya incluye canción + URL: es la identidad exacta de la miniatura.
  }, [cacheId]);

  const handleError = () => {
    const next = mode === 'direct' ? 'proxy' : 'failed';
    setArtworkMode(song, src, next);
    setMode(next);
  };

  if (!src || mode === 'failed') {
    return (
      <span className={`${className} ${emptyClassName || ''}`.trim()}>
        <FaMusic />
      </span>
    );
  }

  return (
    <img
      {...imgProps}
      className={className}
      src={mode === 'proxy' ? proxiedArtworkUrl(src) : src}
      alt={alt}
      onError={handleError}
    />
  );
}
