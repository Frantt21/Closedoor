import React, { useEffect } from 'react';
import { Turnstile } from 'react-turnstile';

/**
 * TurnstileCaptcha — widget de Cloudflare Turnstile para los formularios de auth.
 *
 * - Si no hay VITE_TURNSTILE_SITE_KEY configurada (dev local sin claves),
 *   el widget NO se renderiza y se reporta token null → el form funciona igual
 *   que antes (degradación silenciosa).
 * - Con site key presente, resuelve el reto y llama onTokenChange(token).
 *   Si el token expira o falla, vuelve a reportar null (el submit se bloquea).
 * - El padre puede remontar el widget cambiando `resetKey` (se usa como key
 *   interna) para forzar un nuevo reto tras cada intento de submit.
 */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export function isTurnstileActive() {
  return !!TURNSTILE_SITE_KEY;
}

export default function TurnstileCaptcha({ onTokenChange, resetKey = 0, className = '' }) {
  useEffect(() => {
    // Al montar (o remontar por resetKey) siempre se parte sin token
    onTokenChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className={`auth-captcha ${className}`.trim()}>
      <Turnstile
        key={resetKey}
        sitekey={TURNSTILE_SITE_KEY}
        theme="dark"
        onVerify={(token) => onTokenChange?.(token)}
        onExpire={() => onTokenChange?.(null)}
        onError={() => onTokenChange?.(null)}
      />
    </div>
  );
}
