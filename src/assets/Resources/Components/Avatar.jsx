import React from 'react';
import { DEFAULT_AVATAR } from '../../services/helpers';
import { getCdnUrl } from '../../services/cdnService';

/**
 * Avatar — Wrapper para mostrar avatares de usuario.
 * Normaliza automáticamente URLs del CDN para evitar Mixed Content.
 */
export default function Avatar({ src, alt = 'avatar', className, style, onClick, onError: customOnError }) {
  // Normalizar URL del CDN (si es del CDN) o dejar intacta (si es externa como Pinterest)
  const normalizedSrc = getCdnUrl(src) || DEFAULT_AVATAR;

  const handleError = (e) => {
    e.target.src = DEFAULT_AVATAR;
    customOnError?.(e);
  };

  return (
    <img
      className={className}
      src={normalizedSrc}
      alt={alt}
      style={style}
      onClick={onClick}
      onError={handleError}
    />
  );
}
