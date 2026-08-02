import { useEffect } from 'react';

let lockCount = 0;

/**
 * Prevents background scrolling while a modal/overlay is open.
 * Supports multiple simultaneous modals via a stack counter.
 *
 * Bloquea también <html> (root scroller) y overscroll-behavior: en móvil, al
 * abrir el teclado virtual el visual viewport se encoge y algunos browsers
 * (iOS/Android) siguen scrolleando el root aunque body esté oculto.
 */
export default function useLockBodyScroll(locked = true) {
  useEffect(() => {
    if (!locked) return;

    lockCount++;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';

    return () => {
      lockCount--;
      if (lockCount <= 0) {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document.body.style.overscrollBehavior = '';
        lockCount = 0;
      }
    };
  }, [locked]);
}
