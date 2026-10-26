import { useEffect, useState } from 'react';
import { FaMusic } from 'react-icons/fa';
import { songArtworkUrl, proxiedArtworkUrl } from '../../services/musicService';

/**
 * SongArtwork — miniatura de una canción para las cards del chat, el buscador,
 * la card del perfil y el mini reproductor. Las cuatro pintan el MISMO `song`,
 * así que comparten la misma resolución de URL y el mismo respaldo; antes cada
 * una hacía su propio `<img src={song.artwork} onError={hide}>` y, si el CDN no
 * respondía, dejaba un hueco vacío sin explicación.
 *
 * Orden de intentos:
 *   1. La URL del campo `artwork` (o derivada del videoId — songArtworkUrl).
 *   2. La misma imagen por `/api/image-proxy` (same-origin): cubre redes/DNS
 *      que bloquean el CDN, hotlink y CSP antiguas.
 *   3. El icono de música, que es el placeholder ya estilizado de cada card.
 *
 * El estado se reinicia cuando cambia la canción (o su arte), para que una
 * tarjeta reciclada por React no arrastre el fallo de la anterior.
 */
export default function SongArtwork({
  song,
  className,
  emptyClassName,
  alt = '',
  ...imgProps
}) {
  const src = songArtworkUrl(song);
  const [attempt, setAttempt] = useState(0); // 0 directo · 1 proxy · 2 placeholder

  useEffect(() => {
    setAttempt(0);
  }, [src]);

  if (!src || attempt > 1) {
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
      src={attempt === 1 ? proxiedArtworkUrl(src) : src}
      alt={alt}
      onError={() => setAttempt((a) => (a > 1 ? a : a + 1))}
    />
  );
}
