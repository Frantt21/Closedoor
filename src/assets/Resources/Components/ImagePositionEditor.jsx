import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

/**
 * ImagePositionEditor
 *
 * Editor de posicion y zoom para imagenes SIN librerias externas.
 * Soporta drag con mouse para posicion (x,y) y slider para zoom (1x-3x).
 *
 * Props:
 *   imageUrl        – URL de la imagen a editar
 *   initialPosition – String JSON: {"x":50,"y":50,"zoom":1} o legacy "50% 50%"
 *   aspectRatio     – Ratio del contenedor (ej: 1 para avatar, 3/1 para banner)
 *   circular        – true para mascara circular (avatar)
 *   onPositionChange – callback(positionString) donde positionString es JSON
 *   style           – estilo adicional para el contenedor
 */
export default function ImagePositionEditor({
  imageUrl,
  initialPosition,
  aspectRatio = 3 / 1,
  circular = false,
  onPositionChange,
  style,
}) {
  // Parsear posicion inicial
  const parseInitial = () => {
    if (!initialPosition) return { x: 50, y: 50, zoom: 1 };
    if (initialPosition.startsWith('{')) {
      try {
        const p = JSON.parse(initialPosition);
        return {
          x: typeof p.x === 'number' ? p.x : 50,
          y: typeof p.y === 'number' ? p.y : 50,
          zoom: typeof p.zoom === 'number' ? p.zoom : 1,
        };
      } catch {}
    }
    const legacy = String(initialPosition).match(/(\d+(?:\.\d+)?)\s*%\s*(\d+(?:\.\d+)?)\s*%/);
    if (legacy) {
      return { x: parseFloat(legacy[1]), y: parseFloat(legacy[2]), zoom: 1 };
    }
    return { x: 50, y: 50, zoom: 1 };
  };

  const init = parseInitial();
  const [x, setX] = useState(init.x);
  const [y, setY] = useState(init.y);
  const [zoom, setZoom] = useState(init.zoom);

  // Refs para valores actuales (evita closures stale en event listeners)
  const xRef = useRef(x);
  const yRef = useRef(y);
  const zoomRef = useRef(zoom);
  useEffect(() => { xRef.current = x; }, [x]);
  useEffect(() => { yRef.current = y; }, [y]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const dragging = useRef(false);
  // dragStart: almacena posiciones iniciales + currentX/currentY actualizados en RAF
  const dragStart = useRef({ clientX: 0, clientY: 0, startX: 0, startY: 0, currentX: 50, currentY: 50, width: 1, height: 1 });
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => { onPositionChangeRef.current = onPositionChange; }, [onPositionChange]);

  // Notificar cambios al padre
  const notify = useCallback((newX, newY, newZoom) => {
    const payload = JSON.stringify({
      x: Math.round(newX),
      y: Math.round(newY),
      zoom: Math.round(newZoom * 10) / 10,
    });
    onPositionChangeRef.current?.(payload);
  }, []);

  // ── Mouse drag (window-level listeners) ──
  const updateDrag = useCallback((clientX, clientY) => {
    const d = dragStart.current;
    const deltaX = ((clientX - d.clientX) / d.width) * 100;
    const deltaY = ((clientY - d.clientY) / d.height) * 100;
    const newX = Math.max(0, Math.min(100, d.startX - deltaX));
    const newY = Math.max(0, Math.min(100, d.startY - deltaY));
    // Actualizar state + ref sincrónicamente para evitar valores stale
    setX(newX);
    setY(newY);
    d.currentX = newX;
    d.currentY = newY;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => updateDrag(e.clientX, e.clientY));
  }, [updateDrag]);

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    // Leer desde dragStart.current que tiene los valores más recientes
    const d = dragStart.current;
    notify(d.currentX, d.currentY, zoomRef.current);
  }, [handleMouseMove, notify]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = xRef.current, cy = yRef.current;
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: cx,
      startY: cy,
      currentX: cx,
      currentY: cy,
      width: rect.width,
      height: rect.height,
    };
    dragging.current = true;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  // ── Touch drag ──
  const handleTouchMove = useCallback((e) => {
    if (!dragging.current || e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => updateDrag(touch.clientX, touch.clientY));
  }, [updateDrag]);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const d = dragStart.current;
    notify(d.currentX, d.currentY, zoomRef.current);
  }, [handleTouchMove, notify]);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = xRef.current, cy = yRef.current;
    dragStart.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      startX: cx,
      startY: cy,
      currentX: cx,
      currentY: cy,
      width: rect.width,
      height: rect.height,
    };
    dragging.current = true;
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }, [handleTouchMove, handleTouchEnd]);

  // Cleanup window listeners on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  // Zoom handler
  const handleZoomChange = useCallback((e) => {
    setZoom(parseFloat(e.target.value));
  }, []);

  const handleZoomCommit = useCallback(() => {
    notify(xRef.current, yRef.current, zoomRef.current);
  }, [notify]);

  // Reset
  const handleReset = useCallback(() => {
    setX(50);
    setY(50);
    setZoom(1);
    notify(50, 50, 1);
  }, [notify]);

  if (!imageUrl) return null;

  const borderRadius = circular ? '50%' : 'var(--radius-sm, 6px)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {/* ── Image container ── */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: String(aspectRatio),
          overflow: 'hidden',
          borderRadius,
          background: 'var(--color-surface-hover, #252525)',
          cursor: dragging.current ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt="Position preview"
            draggable={false}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: `${x}% ${y}%`,
              transform: zoom !== 1 ? `scale(${zoom})` : 'none',
              transformOrigin: 'center center',
              pointerEvents: 'none',
            }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
      </div>

      {/* ── Controls row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FaSearchMinus style={{ fontSize: '0.8rem', opacity: 0.6, flexShrink: 0 }} />
        <input
          type="range"
          min="1"
          max="3"
          step="0.1"
          value={zoom}
          onChange={handleZoomChange}
          onMouseUp={handleZoomCommit}
          onTouchEnd={handleZoomCommit}
          style={{ flex: 1 }}
          className="fc-modal-range"
        />
        <FaSearchPlus style={{ fontSize: '0.8rem', opacity: 0.6, flexShrink: 0 }} />
        <span style={{ fontSize: '0.75rem', opacity: 0.6, minWidth: 32, textAlign: 'right' }}>
          {zoom.toFixed(1)}x
        </span>
        <button
          type="button"
          onClick={handleReset}
          style={{
            background: 'none',
            border: '1px solid var(--color-border, #2a2a2a)',
            borderRadius: 'var(--radius-sm, 6px)',
            color: 'var(--color-text-muted, #6b7280)',
            fontSize: '0.7rem',
            padding: '2px 8px',
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
