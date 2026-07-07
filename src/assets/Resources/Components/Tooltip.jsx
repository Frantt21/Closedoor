import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_STYLES = {
  position: 'fixed',
  zIndex: 99999,
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: '0.72rem',
  fontWeight: 500,
  lineHeight: 1.4,
  color: '#fff',
  background: 'rgba(30, 30, 35, 0.95)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transition: 'opacity 0.15s ease, transform 0.15s ease',
};

/**
 * Custom tooltip rendered at the document body level via createPortal,
 * so it's never affected by parent transforms or overflow clipping.
 * Shows a small popup above (default) or below the child element on hover.
 */
export default function Tooltip({ text, children, style, className, placement = 'top' }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const targetRef = useRef(null);
  const showTimeoutRef = useRef(null);
  const hideTimeoutRef = useRef(null);

  const isBottom = placement === 'bottom';

  const updatePosition = useCallback(() => {
    if (!targetRef.current) return;
    const rect = targetRef.current.getBoundingClientRect();
    setPosition({
      top: isBottom ? rect.bottom + 6 : rect.top - 6,
      left: rect.left + rect.width / 2,
    });
  }, [isBottom]);

  // Update position on scroll / resize while visible
  // Throttled with requestAnimationFrame to avoid layout thrashing
  // from getBoundingClientRect() on every scroll event
  useEffect(() => {
    if (!visible) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updatePosition();
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, updatePosition]);

  const handleMouseEnter = useCallback(() => {
    clearTimeout(hideTimeoutRef.current);
    showTimeoutRef.current = setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, 150);
  }, [updatePosition]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(showTimeoutRef.current);
    setVisible(false);
  }, []);

  if (!text) return <>{children}</>;

  const visibleTransform = isBottom
    ? 'translate(-50%, 6px)'
    : 'translate(-50%, -100%)';
  const hiddenTransform = isBottom
    ? 'translate(-50%, 0)'
    : 'translate(-50%, calc(-100% + 4px))';

  // Arrow: for 'top' placement, arrow at bottom pointing down;
  // for 'bottom' placement, arrow at top pointing up.
  const arrowStyle = isBottom
    ? {
        position: 'absolute',
        top: -4,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderBottom: '5px solid rgba(30, 30, 35, 0.95)',
      }
    : {
        position: 'absolute',
        bottom: -4,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: '5px solid rgba(30, 30, 35, 0.95)',
      };

  return (
    <>
      <span
        ref={targetRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={className}
        style={{ display: 'inline-flex', ...style }}
      >
        {children}
      </span>
      {createPortal(
        <div
          style={{
            ...TOOLTIP_STYLES,
            top: position.top,
            left: position.left,
            transform: visible ? visibleTransform : hiddenTransform,
            opacity: visible ? 1 : 0,
          }}
        >
          {text}
          {/* Arrow */}
          <div style={arrowStyle} />
        </div>,
        document.body
      )}
    </>
  );
}
