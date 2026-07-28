import React from 'react';
import { DEFAULT_AVATAR } from '../../services/helpers';
import { getCdnUrl } from '../../services/cdnService';
import { useRegisterUserStatus } from '../../../context/UserStatusContext';

/**
 * Avatar — Wrapper para mostrar avatares de usuario.
 * Normaliza automáticamente URLs del CDN para evitar Mixed Content.
 * Si se pasa `status`, muestra un punto indicador de estado.
 * Si se pasa `userId` (sin `status` explícito), obtiene el estado
 * automáticamente del UserStatusContext global, funcionando en
 * cualquier ruta sin necesidad de pasar `status` manualmente.
 *
 * NOTA: className se aplica al <img>, no al wrapper div.
 * El wrapper div solo existe para posicionar el status dot.
 */
export default function Avatar({ src, alt = 'avatar', className, style, onClick, onError: customOnError, status, userId }) {
  const normalizedSrc = getCdnUrl(src) || DEFAULT_AVATAR;
  // Si no se pasa status explícitamente pero hay userId, obtener del contexto global
  const contextStatus = useRegisterUserStatus(!status ? userId : null);
  const effectiveStatus = status || contextStatus;

  const handleError = (e) => {
    e.target.src = DEFAULT_AVATAR;
    customOnError?.(e);
  };

  const showStatus = effectiveStatus && ['online', 'dnd', 'idle', 'disconnected'].includes(effectiveStatus);

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
  // An inner clipping div wraps the img so the status dot (sibling of that div)
  // is NOT clipped by the circular overflow:hidden — critical for profile avatar
  // where the parent container clips to border-radius.
  return (
    <div className={`avatar-wrapper ${className || ''}`.trim()} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 'inherit', overflow: 'hidden' }}>
        <img
          className="avatar-img"
          src={normalizedSrc}
          alt={alt}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', ...style }}
          onClick={onClick}
          onError={handleError}
        />
      </div>
      <span className={`status-dot status-dot--lg status-dot--${effectiveStatus}`} />
    </div>
  );
}
