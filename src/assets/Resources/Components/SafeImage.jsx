import React, { useState } from 'react';
import { FaImage } from 'react-icons/fa';

/**
 * SafeImage — Wrapper around <img> that gracefully handles load errors.
 *
 * - By default: shows a dark placeholder with an icon when the image fails.
 * - hideOnError: returns null when the image fails (no placeholder rendered).
 * - fallbackIcon: custom icon element for the placeholder.
 * - fallbackText: optional text shown alongside the icon.
 *
 * All extra props (onClick, style, etc.) are forwarded to both <img> and the
 * fallback <div> so clicking/handling works in both states.
 */
export default function SafeImage({
  src,
  alt = '',
  className = '',
  hideOnError = false,
  fallbackIcon,
  fallbackText,
  onClick,
  style,
  ...rest
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    if (hideOnError) return null;

    return (
      <div
        className={`safe-image-fallback ${className}`}
        style={style}
        onClick={onClick}
        role="img"
        aria-label={alt || 'Image failed to load'}
      >
        <span className="safe-image-fallback-icon">
          {fallbackIcon || <FaImage />}
        </span>
        {fallbackText && (
          <span className="safe-image-fallback-text">{fallbackText}</span>
        )}
      </div>
    );
  }

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => setHasError(true)}
      style={style}
    />
  );
}
