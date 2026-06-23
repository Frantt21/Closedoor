import { useEffect } from 'react';

let lockCount = 0;

/**
 * Prevents background scrolling while a modal/overlay is open.
 * Supports multiple simultaneous modals via a stack counter.
 */
export default function useLockBodyScroll(locked = true) {
  useEffect(() => {
    if (!locked) return;

    lockCount++;
    document.body.style.overflow = 'hidden';

    return () => {
      lockCount--;
      if (lockCount <= 0) {
        document.body.style.overflow = '';
        lockCount = 0;
      }
    };
  }, [locked]);
}
