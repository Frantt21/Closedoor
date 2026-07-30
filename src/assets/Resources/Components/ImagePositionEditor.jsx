import React, { useState, useRef, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { FaSearchPlus, FaSearchMinus, FaUndo, FaArrowsAltH, FaArrowsAltV, FaRedo } from 'react-icons/fa';

/**
 * ImagePositionEditor
 *
 * Usa react-easy-crop (<Cropper>) para ofrecer interacción suave de
 * arrastrar, zoom con rueda/pellizco y rotación. Internamente mantiene
 * el formato de posición propio de la app:
 *   { x, y, zoom, rotation, flipX, flipY }
 *
 * Compatible hacia atrás con el formato legacy "X% Y%" y el JSON string.
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

/**
 * Convierte nuestra focal-point percentage (x%, y%) al crop en píxeles
 * que react-easy-crop necesita (translate del centro de la imagen).
 *
 * Fórmula:
 *   cropX = (50 - x%) / 50 * (containerW * (zoom - 1) / 2)
 *   cropY = (50 - y%) / 50 * (containerH * (zoom - 1) / 2)
 *
 * Cuando zoom === 1, la imagen llena exactamente el viewport y no hay
 * traducción posible → { x: 0, y: 0 }.
 */
function percentToCrop(xPct, yPct, zoomVal, containerW, containerH) {
  if (zoomVal <= 1 || containerW <= 0 || containerH <= 0) return { x: 0, y: 0 };
  const excessW = containerW * (zoomVal - 1);
  const excessH = containerH * (zoomVal - 1);
  return {
    x: ((50 - xPct) / 50) * (excessW / 2),
    y: ((50 - yPct) / 50) * (excessH / 2),
  };
}

/**
 * Inversa: del crop en píxeles de react-easy-crop a nuestras percentages.
 */
function cropToPercent(cropX, cropY, zoomVal, containerW, containerH) {
  if (zoomVal <= 1 || containerW <= 0 || containerH <= 0) return { x: 50, y: 50 };
  const excessW = containerW * (zoomVal - 1);
  const excessH = containerH * (zoomVal - 1);
  return {
    x: Math.max(0, Math.min(100, 50 - (cropX * 50) / (excessW / 2))),
    y: Math.max(0, Math.min(100, 50 - (cropY * 50) / (excessH / 2))),
  };
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
  const initialPosRef = useRef(parseEncodedPosition(initialPosition));

  // ── Estados para react-easy-crop ──
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialPosRef.current.zoom);
  const [rotation, setRotation] = useState(initialPosRef.current.rotation);
  const [flipX, setFlipX] = useState(initialPosRef.current.flipX);
  const [flipY, setFlipY] = useState(initialPosRef.current.flipY);

  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 300, h: 200 });
  const initDoneRef = useRef(false);

  // ── Medir el contenedor tras montar ──
  useEffect(() => {
    if (!containerRef.current || initDoneRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width || 300;
    const h = rect.height || 200;
    setContainerSize({ w, h });
    const p = initialPosRef.current;
    const initialCrop = percentToCrop(p.x, p.y, p.zoom, w, h);
    setCrop(initialCrop);
    setZoom(p.zoom);
    setRotation(p.rotation);
    setFlipX(p.flipX);
    setFlipY(p.flipY);
    initDoneRef.current = true;
  }, []);

  // ── Re-medir si la imagen cambia (nueva imagen → re-centrar) ──
  const prevImageRef = useRef(imageUrl);
  useEffect(() => {
    if (!imageUrl || imageUrl === prevImageRef.current) return;
    prevImageRef.current = imageUrl;
    // Reset flip/rotation cuando cambia la imagen
    setFlipX(false);
    setFlipY(false);
    setRotation(0);
    // Re-centrar crop
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const w = rect.width || 300;
      const h = rect.height || 200;
      setContainerSize({ w, h });
      const p = initialPosRef.current;
      const initialCrop = percentToCrop(p.x, p.y, zoom, w, h);
      setCrop(initialCrop);
      setZoom(p.zoom);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // ── Notificar al padre ──
  const lastEncodedRef = useRef('');
  const notify = useCallback((pos) => {
    onPositionChange?.(encodePosition(pos));
  }, [onPositionChange]);

  useEffect(() => {
    const xy = cropToPercent(crop.x, crop.y, zoom, containerSize.w, containerSize.h);
    const pos = { x: xy.x, y: xy.y, zoom, rotation, flipX, flipY };
    const encoded = encodePosition(pos);
    if (encoded !== lastEncodedRef.current) {
      lastEncodedRef.current = encoded;
      notify(pos);
    }
  }, [crop, zoom, rotation, flipX, flipY, containerSize, notify]);

  // ── Callbacks de Cropper ──
  const handleCropChange = useCallback((newCrop) => {
    setCrop(newCrop);
  }, []);

  const handleZoomChange = useCallback((newZoom) => {
    setZoom(newZoom);
  }, []);

  const handleRotationChange = useCallback((newRotation) => {
    setRotation(newRotation);
  }, []);

  // ── Controles manuales ──
  const handleZoomIn = () => setZoom((v) => Math.min(ZOOM_MAX, +(v + ZOOM_STEP).toFixed(1)));
  const handleZoomOut = () => setZoom((v) => Math.max(ZOOM_MIN, +(v - ZOOM_STEP).toFixed(1)));
  const handleRotateLeft = () => setRotation((v) => ((v - 90) % 360 + 360) % 360);
  const handleRotateRight = () => setRotation((v) => (v + 90) % 360);
  const handleFlipX = () => setFlipX((v) => !v);
  const handleFlipY = () => setFlipY((v) => !v);

  const handleReset = () => {
    const r = { x: 50, y: 50, zoom: 1, rotation: 0, flipX: false, flipY: false };
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
      setCrop(percentToCrop(50, 50, 1, rect.width, rect.height));
    } else {
      setCrop({ x: 0, y: 0 });
    }
    setZoom(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    notify(r);
  };

  // ── No image state ──
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

  // ── Botones inline ──
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

  return (
    <div className="image-position-editor" style={{ width: '100%', userSelect: 'none' }}>
      {/* ── Cropper ── */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${aspectRatio} / 1`,
          borderRadius: circular ? '50%' : 'var(--radius-sm, 6px)',
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {/* Wrapper para flip — Cropper no soporta flip nativamente,
            así que lo aplicamos como transform CSS en un wrapper. */}
        <div style={{
          width: '100%',
          height: '100%',
          transform: `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
        }}>
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspectRatio}
            onCropChange={handleCropChange}
            onZoomChange={handleZoomChange}
            objectFit="cover"
            style={{
              containerStyle: {
                borderRadius: circular ? '50%' : 'inherit',
              },
            }}
          />
        </div>
        {overlay}
        <div
          style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.72rem',
            padding: '3px 10px', borderRadius: 999, pointerEvents: 'none', whiteSpace: 'nowrap',
            zIndex: 10,
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
          <button type="button" style={flipX ? btnActive : btn} onClick={handleFlipX} title="Flip horizontally"
            onMouseEnter={(e) => { if (!flipX) btnHover(e); }} onMouseLeave={(e) => { if (!flipX) btnLeave(e); }}><FaArrowsAltH /></button>
          <button type="button" style={flipY ? btnActive : btn} onClick={handleFlipY} title="Flip vertically"
            onMouseEnter={(e) => { if (!flipY) btnHover(e); }} onMouseLeave={(e) => { if (!flipY) btnLeave(e); }}><FaArrowsAltV /></button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={handleReset} title="Reset"
            style={{ ...btn, width: 'auto', padding: '0 10px', fontSize: '0.72rem' }}
            onMouseEnter={btnHover} onMouseLeave={btnLeave}>Reset</button>
        </div>

        {/* Zoom slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30, textAlign: 'right' }}>{ZOOM_MIN}x</span>
          <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom}
            onChange={(e) => handleZoomChange(+parseFloat(e.target.value).toFixed(1))}
            style={{ width: '100%', height: 4, accentColor: 'var(--color-text, #ffffff)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30 }}>{ZOOM_MAX}x</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary, #9ca3af)', minWidth: 40, textAlign: 'center' }}>{zoom.toFixed(1)}x</span>
        </div>

        {/* Rotation slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30, textAlign: 'right' }}>0°</span>
          <input type="range" min={0} max={360} step={1} value={rotation}
            onChange={(e) => handleRotationChange(parseInt(e.target.value, 10))}
            style={{ width: '100%', height: 4, accentColor: 'var(--color-text, #ffffff)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted, #6b7280)', minWidth: 30 }}>360°</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary, #9ca3af)', minWidth: 40, textAlign: 'center' }}>{rotation}°</span>
        </div>
      </div>
    </div>
  );
}
