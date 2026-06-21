import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * ImagePositionEditor
 * 
 * Permite arrastrar una imagen dentro de un contenedor con object-fit:cover
 * para ajustar el punto focal. Retorna la posición como "X% Y%" (object-position).
 *
 * NOTA: Este componente se remonta vía key al cambiar la URL o tipo,
 * así que initialPosition solo se usa durante la inicialización.
 * 
 * Props:
 *  - imageUrl: string | null   — URL de la imagen a posicionar
 *  - initialPosition: string   — posición inicial (ej "50% 50%")
 *  - aspectRatio: number       — aspect ratio del contenedor (default 40/11 ≈ 3.64, como el banner de perfil a su ancho máximo 800px)
 *  - onPositionChange: (pos: string) => void
 */
export default function ImagePositionEditor({
  imageUrl,
  initialPosition = '50% 50%',
  aspectRatio = 40 / 11,
  onPositionChange,
}) {
  const parsePosition = (pos) => {
    if (!pos) return { x: 50, y: 50 };
    const parts = pos.split(/\s+/);
    return {
      x: parseFloat(parts[0]) || 50,
      y: parseFloat(parts[1]) || 50,
    };
  };

  const [pos, setPos] = useState(() => parsePosition(initialPosition));
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Notificar cambios hacia arriba
  const notify = useCallback((newPos) => {
    const str = `${newPos.x}% ${newPos.y}%`;
    onPositionChange?.(str);
  }, [onPositionChange]);

  const handleMouseDown = useCallback((e) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current || !containerRef.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = (dx / rect.width) * 100;
    const deltaY = (dy / rect.height) * 100;

    setPos((prev) => {
      const newPos = {
        x: Math.max(0, Math.min(100, prev.x - deltaX)),
        y: Math.max(0, Math.min(100, prev.y - deltaY)),
      };
      notify(newPos);
      return newPos;
    });
  }, [notify]);

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Touch support
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragging.current = true;
    lastMouse.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!dragging.current || !containerRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - lastMouse.current.x;
    const dy = touch.clientY - lastMouse.current.y;
    lastMouse.current = { x: touch.clientX, y: touch.clientY };

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = (dx / rect.width) * 100;
    const deltaY = (dy / rect.height) * 100;

    setPos((prev) => {
      const newPos = {
        x: Math.max(0, Math.min(100, prev.x - deltaX)),
        y: Math.max(0, Math.min(100, prev.y - deltaY)),
      };
      notify(newPos);
      return newPos;
    });
  }, [notify]);

  const handleTouchEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  // Attach global listeners for mouse/touch
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  if (!imageUrl) {
    return (
      <div
        className="image-position-editor"
        style={{
          width: '100%',
          aspectRatio: `${aspectRatio} / 1`,
          background: 'var(--color-surface, #1a1a1a)',
          borderRadius: 'var(--radius-sm, 6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted, #6b7280)',
          fontSize: '0.8rem',
        }}
      >
        No image
      </div>
    );
  }

  return (
    <div className="image-position-editor" style={{ width: '100%', userSelect: 'none' }}>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{
          width: '100%',
          aspectRatio: `${aspectRatio} / 1`,
          overflow: 'hidden',
          borderRadius: 'var(--radius-sm, 6px)',
          cursor: dragging.current ? 'grabbing' : 'grab',
          position: 'relative',
          background: '#000',
        }}
      >
        <img
          src={imageUrl}
          alt="Drag to reposition"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${pos.x}% ${pos.y}%`,
            pointerEvents: 'none',
            display: 'block',
          }}
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        {/* Instructional overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: '0.72rem',
            padding: '3px 10px',
            borderRadius: 999,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Drag to reposition
        </div>
      </div>
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--color-text-muted, #6b7280)',
          marginTop: 4,
          textAlign: 'center',
        }}
      >
        {pos.x.toFixed(0)}% {pos.y.toFixed(0)}
      </div>
    </div>
  );
}
