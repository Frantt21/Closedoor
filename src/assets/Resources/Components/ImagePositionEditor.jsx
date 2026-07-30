import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

/**
 * ImagePositionEditor
 *
 * Editor de posicion y zoom para imagenes SIN librerias externas.
 *
 * El drag manipula el DOM directamente (sin pasar por React state) para
 * lograr respuesta instantánea.
 *
 * CRITICO: NO usamos object-position para posicionar porque con
 * object-fit: cover y aspect ratios iguales, el image content llena
 * el element box completamente — no hay espacio para reposicionar.
 *
 * En cambio, usamos transform: translate() para mover el ELEMENTO
 * ENTERO (no solo el contenido dentro de él), combinado con scale()
 * para el zoom. Así el posicionamiento funciona SIEMPRE.
 *
 * Props:
 *   imageUrl        – URL de la imagen a editar
 *   initialPosition – String JSON: {"x":50,"y":50,"zoom":1} o legacy "50% 50%"
 *   aspectRatio     – Ratio del contenedor (ej: 1 para avatar, 3 para banner)
 *   circular        – true para mascara circular (avatar)
 *   onPositionChange – callback(positionString) donde positionString es JSON
 *   style           – estilo adicional para el contenedor
 */
export default function ImagePositionEditor({
  imageUrl,
  initialPosition,
  aspectRatio = 3,
  circular = false,
  onPositionChange,
  style,
}) {
  // ── Parse initial position ──
  const parsePos = (str) => {
    if (!str) return { x: 50, y: 50, zoom: 1 };
    if (typeof str === 'string' && str.startsWith('{')) {
      try {
        const p = JSON.parse(str);
        return {
          x: typeof p.x === 'number' ? p.x : 50,
          y: typeof p.y === 'number' ? p.y : 50,
          zoom: typeof p.zoom === 'number' ? p.zoom : 1,
        };
      } catch {}
    }
    const m = String(str).match(/(\d+(?:\.\d+)?)\s*%\s*(\d+(?:\.\d+)?)\s*%/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]), zoom: 1 };
    return { x: 50, y: 50, zoom: 1 };
  };

  const init = parsePos(initialPosition);
  const [x, setX] = useState(init.x);
  const [y, setY] = useState(init.y);
  const [zoom, setZoom] = useState(init.zoom);

  // Sincronizar refs con state
  const xRef = useRef(x);
  const yRef = useRef(y);
  const zoomRef = useRef(zoom);
  useEffect(() => { xRef.current = x; }, [x]);
  useEffect(() => { yRef.current = y; }, [y]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const dragging = useRef(false);
  const dragStart = useRef({ clientX: 0, clientY: 0, startX: 0, startY: 0, width: 1, height: 1 });
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => { onPositionChangeRef.current = onPositionChange; }, [onPositionChange]);

  // Tamaño del contenedor (medido vía ref callback, inmediato)
  const containerSizeRef = useRef({ width: 1, height: 1 });
  const containerCallbackRef = useCallback((node) => {
    containerRef.current = node;
    if (node) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerSizeRef.current = { width: rect.width, height: rect.height };
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sincronizar transform inicial después de que todos los refs estén listos
  useEffect(() => {
    panTo(xRef.current, yRef.current, Math.max(zoomRef.current, 1.05));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // panTo no está en deps porque se actualiza con containerSizeRef

  // Zoom de visualización: mínimo 1.05x para que siempre haya overflow
  const displayZoom = Math.max(zoom, 1.05);

  // Calcular translate en píxeles para una posición (x,y) y zoom dados
  const panTo = useCallback((posX, posY, z) => {
    if (!imgRef.current) return;
    const { width: cw, height: ch } = containerSizeRef.current;
    const panX = (50 - posX) * (z - 1) * cw / (100 * z);
    const panY = (50 - posY) * (z - 1) * ch / (100 * z);
    imgRef.current.style.transform = `translate(${panX}px, ${panY}px) scale(${z})`;
  }, []);

  // Notificar cambios al padre
  const notify = useCallback(() => {
    const payload = JSON.stringify({
      x: Math.round(xRef.current),
      y: Math.round(yRef.current),
      zoom: Math.round(zoomRef.current * 10) / 10,
    });
    onPositionChangeRef.current?.(payload);
  }, []);

  // ── Actualizar DOM durante el drag ──
  const updateDrag = useCallback((clientX, clientY) => {
    const d = dragStart.current;
    const deltaX = ((clientX - d.clientX) / d.width) * 100;
    const deltaY = ((clientY - d.clientY) / d.height) * 100;
    const newX = Math.round(Math.max(0, Math.min(100, d.startX - deltaX)));
    const newY = Math.round(Math.max(0, Math.min(100, d.startY - deltaY)));
    const z = Math.max(zoomRef.current, 1.05);

    // Posicionar vía translate + scale sobre el DOM directamente
    const panX = (50 - newX) * (z - 1) * d.width / (100 * z);
    const panY = (50 - newY) * (z - 1) * d.height / (100 * z);
    imgRef.current.style.transform = `translate(${panX}px, ${panY}px) scale(${z})`;

    xRef.current = newX;
    yRef.current = newY;
  }, []);

  // ── Mouse ──
  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    updateDrag(e.clientX, e.clientY);
  }, [updateDrag]);

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    setX(xRef.current);
    setY(yRef.current);
    notify();
  }, [handleMouseMove, notify]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: xRef.current,
      startY: yRef.current,
      width: rect.width,
      height: rect.height,
    };
    dragging.current = true;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  // ── Touch ──
  const handleTouchMove = useCallback((e) => {
    if (!dragging.current || e.touches.length !== 1) return;
    e.preventDefault();
    updateDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, [updateDrag]);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    setX(xRef.current);
    setY(yRef.current);
    notify();
  }, [handleTouchMove, notify]);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    dragStart.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      startX: xRef.current,
      startY: yRef.current,
      width: rect.width,
      height: rect.height,
    };
    dragging.current = true;
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }, [handleTouchMove, handleTouchEnd]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  // ── Zoom ──
  const handleZoomChange = useCallback((e) => {
    const z = parseFloat(e.target.value);
    setZoom(z);
    zoomRef.current = z;
    // Re-posicionar con el nuevo zoom
    panTo(xRef.current, yRef.current, Math.max(z, 1.05));
  }, [panTo]);

  const handleZoomCommit = useCallback(() => {
    notify();
  }, [notify]);

  // Reset
  const handleReset = useCallback(() => {
    setX(50);
    setY(50);
    setZoom(1);
    xRef.current = 50;
    yRef.current = 50;
    zoomRef.current = 1;
    panTo(50, 50, 1.05);
    notify();
  }, [panTo, notify]);

  if (!imageUrl) return null;

  const borderRadius = circular ? '50%' : 'var(--radius-sm, 6px)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {/* ── Image container ── */}
      <div
        ref={containerCallbackRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: String(aspectRatio),
          overflow: 'hidden',
          borderRadius,
          background: 'var(--color-surface-hover, #252525)',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Position preview"
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            // object-position no se usa porque no funciona cuando el
            // image content llena el element box completamente.
            // En su lugar, transform: translate() + scale() posiciona
            // el ELEMENTO ENTERO, que siempre tiene efecto.
            transformOrigin: 'center center',
            pointerEvents: 'none',
          }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
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
