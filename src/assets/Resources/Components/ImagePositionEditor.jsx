import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus, FaUndo, FaArrowsAltH, FaArrowsAltV, FaRedo } from 'react-icons/fa';

/**
 * ImagePositionEditor
 *
 * Usa un <img> con object-fit: cover para que el zoom=1.0x llene el
 * contenedor exactamente igual que el perfil real. Zoom, rotación y flip
 * se aplican mediante CSS transform.
 *
 * Almacena la configuración como JSON string:
 *   { x, y, zoom, rotation, flipX, flipY }
 *
 * Compatible hacia atrás con el formato legacy "X% Y%".
 *
 * Props:
 *  - imageUrl: string | null
 *  - initialPosition: string   — legacy "X% Y%" o JSON string
 *  - aspectRatio: number       — aspect ratio del contenedor
 *  - circular: boolean         — si es true, borderRadius: 50%
 *  - onPositionChange: (encoded: string) => void
 *  - overlay: ReactNode        — contenido superpuesto sobre la imagen (ej. dim overlay del banner)
 */

function parseEncodedPosition(pos) {
  if (!pos) return { x: 50, y: 50, zoom: 1, rotation: 0, flipX: false, flipY: false };

  try {
    const parsed = JSON.parse(pos);
    if (parsed && typeof parsed === 'object' && 'x' in parsed) {
      return {
        x: typeof parsed.x === 'number' ? parsed.x : 50,
        y: typeof parsed.y === 'number' ? parsed.y : 50,
        zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1,
        rotation: typeof parsed.rotation === 'number' ? parsed.rotation : 0,
        flipX: !!parsed.flipX,
        flipY: !!parsed.flipY,
      };
    }
  } catch { /* not JSON */ }

  const parts = pos.split(/\s+/);
  return {
    x: parseFloat(parts[0]) || 50,
    y: parseFloat(parts[1]) || 50,
    zoom: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  };
}

function encodePosition(data) {
  return JSON.stringify({
    x: Math.round(data.x),
    y: Math.round(data.y),
    zoom: Math.round(data.zoom * 100) / 100,
    rotation: Math.round(data.rotation),
    flipX: data.flipX,
    flipY: data.flipY,
  });
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

export default function ImagePositionEditor({
  imageUrl,
  initialPosition = '50% 50%',
  aspectRatio = 40 / 11,
  circular = false,
  onPositionChange,
  overlay = null,
}) {
  const [pos, setPos] = useState(() => parseEncodedPosition(initialPosition));
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const notify = useCallback((newData) => {
    // Guard: si newData es undefined (p.ej. React StrictMode re-ejecutando el updater),
    // no llamar a encodePosition que rompería con "Cannot read properties of undefined"
    if (!newData) return;
    onPositionChange?.(encodePosition(newData));
  }, [onPositionChange]);

  const updatePos = useCallback((updater) => {
    let next;
    setPos((prev) => {
      next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
    // notify MUST be called outside the setState updater to avoid
    // "Cannot update a component while rendering a different component"
    if (next) notify(next);
  }, [notify]);

  // ── Drag ──
  const handleMouseDown = useCallback((e) => {
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const doDrag = useCallback((clientX, clientY) => {
    if (!dragging.current || !containerRef.current) return;
    const dx = clientX - lastMouse.current.x;
    const dy = clientY - lastMouse.current.y;
    lastMouse.current = { x: clientX, y: clientY };

    const rect = containerRef.current.getBoundingClientRect();
    // El arrastre es libre: mapea el movimiento del mouse a porcentaje
    // de la imagen. Sin constraints — el usuario puede arrastrar a cualquier
    // posición (incluso negativa o >100) para un control total.
    const deltaX = (dx / rect.width) * 100;
    const deltaY = (dy / rect.height) * 100;

    updatePos((prev) => ({
      ...prev,
      x: prev.x - deltaX,
      y: prev.y - deltaY,
    }));
  }, [updatePos]);

  const handleMouseMove = useCallback((e) => doDrag(e.clientX, e.clientY), [doDrag]);
  const handleMouseUp = useCallback(() => { dragging.current = false; }, []);
  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0];
    if (!t) return;
    dragging.current = true;
    lastMouse.current = { x: t.clientX, y: t.clientY };
  }, []);
  const handleTouchMove = useCallback((e) => {
    const t = e.touches[0];
    if (!t) return;
    doDrag(t.clientX, t.clientY);
  }, [doDrag]);
  const handleTouchEnd = useCallback(() => { dragging.current = false; }, []);

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

  // ── Controls ──
  const handleZoomIn = () => updatePos((p) => ({ ...p, zoom: Math.min(ZOOM_MAX, +(p.zoom + ZOOM_STEP).toFixed(1)) }));
  const handleZoomOut = () => updatePos((p) => ({ ...p, zoom: Math.max(ZOOM_MIN, +(p.zoom - ZOOM_STEP).toFixed(1)) }));
  const handleRotateLeft = () => updatePos((p) => ({ ...p, rotation: ((p.rotation - 90) % 360 + 360) % 360 }));
  const handleRotateRight = () => updatePos((p) => ({ ...p, rotation: (p.rotation + 90) % 360 }));
  const handleFlipX = () => updatePos((p) => ({ ...p, flipX: !p.flipX }));
  const handleFlipY = () => updatePos((p) => ({ ...p, flipY: !p.flipY }));
  const handleReset = () => {
    const r = { x: 50, y: 50, zoom: 1, rotation: 0, flipX: false, flipY: false };
    setPos(r);
    notify(r);
  };

  const buildTransform = () => {
    const t = [];
    // Zoom se maneja con width/height + object-fit: cover, no con
    // transform: scale(), para evitar clipping del borde del contenedor.
    if (pos.rotation !== 0) t.push(`rotate(${pos.rotation}deg)`);
    if (pos.flipX) t.push(`scaleX(-1)`);
    if (pos.flipY) t.push(`scaleY(-1)`);
    return t.join(' ');
  };

  if (!imageUrl) {
    return (
      <div style={{
        width: '100%', aspectRatio: `${aspectRatio} / 1`,
        background: 'var(--color-surface, #1a1a1a)', borderRadius: circular ? '50%' : 'var(--radius-sm, 6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-text-muted, #6b7280)', fontSize: '0.8rem',
      }}>
        No image
      </div>
    );
  }

  const btn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32,
    border: '1px solid var(--color-border, #2a2a2a)', borderRadius: 'var(--radius-sm, 6px)',
    background: 'var(--color-surface, #1a1a1a)', color: 'var(--color-text-secondary, #9ca3af)',
    cursor: 'pointer', fontSize: '0.78rem', transition: 'background 0.15s ease, color 0.15s ease',
  };
  const btnActive = { ...btn, background: 'var(--color-text, #ffffff)', color: 'var(--color-bg, #000000)', borderColor: 'var(--color-text, #ffffff)' };
  const btnHover = (e) => { e.currentTarget.style.background = 'var(--color-surface-hover, #252525)'; e.currentTarget.style.color = 'var(--color-text, #ffffff)'; };
  const btnLeave = (e) => { e.currentTarget.style.background = 'var(--color-surface, #1a1a1a)'; e.currentTarget.style.color = 'var(--color-text-secondary, #9ca3af)'; };
  const btnHoverActive = (e) => { if (!pos.flipX) btnHover(e); };
  const btnLeaveActive = (e) => { if (!pos.flipX) btnLeave(e); };

  return (
    <div className="image-position-editor" style={{ width: '100%', userSelect: 'none' }}>
      {/* ── Contenedor con <img> + object-fit: cover ── */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{
          width: '100%',
          aspectRatio: `${aspectRatio} / 1`,
          overflow: 'hidden',
          borderRadius: circular ? '50%' : 'var(--radius-sm, 6px)',
          cursor: dragging.current ? 'grabbing' : 'grab',
          position: 'relative',
          background: '#000',
        }}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{
            // Zoom via tamaño real de la imagen + object-fit: cover
            // El contenedor overflow:hidden recorta lo que sobresale sin distorsionar
            width: `${100 * pos.zoom}%`,
            height: `${100 * pos.zoom}%`,
            objectFit: 'cover',
            objectPosition: `${pos.x}% ${pos.y}%`,
            transform: buildTransform(),
            willChange: 'transform',
            display: 'block',
          }}
        />
        {overlay}
        <div
          style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.72rem',
            padding: '3px 10px', borderRadius: 999, pointerEvents: 'none', whiteSpace: 'nowrap',
          }}
        >
          Drag to reposition
        </div>
      </div>

      {/* ── Controles ── */}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <button type="button" style={btn} onClick={handleZoomOut} title="Zoom out"
            onMouseEnter={btnHover} onMouseLeave={btnLeave}><FaSearchMinus /></button>
          <button type="button" style={btn} onClick={handleZoomIn} title="Zoom in"
            onMouseEnter={btnHover} onMouseLeave={btnLeave}><FaSearchPlus /></button>
          <div style={{ width: 1, height: 20, background: 'var(--color-border, #2a2a2a)' }} />
          <button type="button" style={btn} onClick={handleRotateLeft} title="Rotate left (-90°)" 
            onMouseEnter={btnHover} onMouseLeave={btnLeave}><FaUndo /></button>
          <button type="button" style={btn} onClick={handleRotateRight} title="Rotate right (+90°)" 
            onMouseEnter={btnHover} onMouseLeave={btnLeave}><FaRedo /></button>
          <div style={{ width: 1, height: 20, background: 'var(--color-border, #2a2a2a)' }} />
          <button type="button" style={pos.flipX ? btnActive : btn} onClick={handleFlipX} title="Flip horizontally"
            onMouseEnter={btnHoverActive} onMouseLeave={btnLeaveActive}><FaArrowsAltH /></button>
          <button type="button" style={pos.flipY ? btnActive : btn} onClick={handleFlipY} title="Flip vertically"
            onMouseEnter={(e) => { if (!pos.flipY) btnHover(e); }} onMouseLeave={(e) => { if (!pos.flipY) btnLeave(e); }}><FaArrowsAltV /></button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleReset} title="Reset"
            style={{ ...btn, width: 'auto', padding: '0 10px', fontSize: '0.72rem' }}
            onMouseEnter={btnHover} onMouseLeave={btnLeave}>Reset</button>
        </div>

        {/* Zoom slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30, textAlign: 'right' }}>{ZOOM_MIN}x</span>
          <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={pos.zoom}
            onChange={(e) => updatePos((p) => ({ ...p, zoom: +parseFloat(e.target.value).toFixed(1) }))}
            style={{ width: '100%', height: 4, accentColor: 'var(--color-text, #ffffff)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30 }}>{ZOOM_MAX}x</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary, #9ca3af)', minWidth: 40, textAlign: 'center' }}>{pos.zoom.toFixed(1)}x</span>
        </div>

        {/* Rotation slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30, textAlign: 'right' }}>0°</span>
          <input type="range" min={0} max={360} step={1} value={pos.rotation}
            onChange={(e) => updatePos((p) => ({ ...p, rotation: parseInt(e.target.value, 10) }))}
            style={{ width: '100%', height: 4, accentColor: 'var(--color-text, #ffffff)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30 }}>360°</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary, #9ca3af)', minWidth: 40, textAlign: 'center' }}>{pos.rotation}°</span>
        </div>
      </div>

      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', marginTop: 4, textAlign: 'center' }}>
        {pos.x.toFixed(0)}% {pos.y.toFixed(0)} · {pos.zoom.toFixed(1)}x · {pos.rotation}°{pos.flipX ? ' · H' : ''}{pos.flipY ? ' · V' : ''}
      </div>
    </div>
  );
}
