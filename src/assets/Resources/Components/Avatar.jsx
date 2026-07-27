import React from 'react';
import { DEFAULT_AVATAR } from '../../services/helpers';
import { getCdnUrl } from '../../services/cdnService';

/**
 * Avatar — Wrapper para mostrar avatares de usuario.
 * Normaliza automáticamente URLs del CDN para evitar Mixed Content.
 * Si se pasa `status`, muestra un punto indicador de estado.
 *
 * NOTA: className se aplica al <img>, no al wrapper div.
 * El wrapper div solo existe para posicionar el status dot.
 */
export default function Avatar({ src, alt = 'avatar', className, style, onClick, onError: customOnError, status }) {
  const normalizedSrc = getCdnUrl(src) || DEFAULT_AVATAR;

  const handleError = (e) => {
    e.target.src = DEFAULT_AVATAR;
    customOnError?.(e);
  };

  const showStatus = status && ['online', 'dnd', 'idle', 'disconnected'].includes(status);

  // If no status, render a plain <img> to avoid breaking any existing layout
  if (!showStatus) {
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

  // With status, wrap in a div for the dot positioning.
  // The style (transform/objectPosition) goes on the inner <img>
  // so the status dot isn't affected by rotation, flip, or zoom.
  return (
    <div className={`avatar-wrapper ${className || ''}`.trim()} style={{ position: 'relative', display: 'inline-flex' }}>
      <img
        className="avatar-img"
        src={normalizedSrc}
        alt={alt}
        style={{ display: 'block', width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover', ...style }}
        onClick={onClick}
        onError={handleError}
      />
      <span className={`status-dot status-dot--${status}`} />
    </div>
  );
}
