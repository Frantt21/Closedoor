import React from 'react';
import { DEFAULT_AVATAR } from '../../services/helpers';

export default function Avatar({ src, alt = 'avatar', className, style, onClick, onError: customOnError }) {
  const handleError = (e) => {
    e.target.src = DEFAULT_AVATAR;
    customOnError?.(e);
  };

  return (
    <img
      className={className}
      src={src || DEFAULT_AVATAR}
      alt={alt}
      style={style}
      onClick={onClick}
      onError={handleError}
    />
  );
}
