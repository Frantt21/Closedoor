import { useState } from 'react';
import { appLogoUrl } from '../../services/appLogos';

/**
 * Logo de un programa compartido: WebP de apistemic cuando conocemos su dominio,
 * y si no hay mapa o la imagen falla, el `fallback` que pase cada sitio (icono
 * real del .exe en Ajustes, glifo de marca en el perfil).
 *
 * El estado de error es por instancia: si un logo concreto falla, esa fila cae al
 * respaldo sin afectar a las demás.
 *
 * @param {object} props
 * @param {string} props.title - nombre guardado del programa (p. ej. "Spotify")
 * @param {string} [props.imgClassName]
 * @param {React.ReactNode} props.fallback
 */
export default function ProgramLogo({ title, imgClassName, fallback }) {
  const url = appLogoUrl(title);
  const [failed, setFailed] = useState(false);

  if (!url || failed) return fallback;

  return (
    <img
      src={url}
      alt=""
      className={imgClassName}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
