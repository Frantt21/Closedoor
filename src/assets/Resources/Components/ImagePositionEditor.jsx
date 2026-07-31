import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

/**
 * ImagePositionEditor
 *
 * Editor de posicion y zoom para imagenes SIN librerias externas.
 *
 * La imagen se muestra con object-fit: contain para que se vea COMPLETA
 * en su ratio original, sin ser forzada al aspect ratio del contenedor.
 * El zoom se aplica agrandando el elemento (width/height en vez de
 * transform: scale), y translate() mueve el elemento agrandado.
 * El drag es 1:1 en píxeles.
 *
 * Props:
 *   imageUrl        – URL de la imagen a editar
 *   initialPosition – String JSON: {"x":50,"y":50,"zoom":1}
 *   aspectRatio     – Ratio del contenedor (ej: 1 para avatar, 3 para banner)
 *   circular        – true para mascara circular (avatar)
 *   onPositionChange – callback(positionString)
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
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 1, h: 1 });

  // Refs
  const xRef = useRef(x);
  const yRef = useRef(y);
  const zoomRef = useRef(zoom);
  const imgNaturalRef = useRef({ w: 1, h: 1 });
  useEffect(() => { xRef.current = x; }, [x]);
  useEffect(() => { yRef.current = y; }, [y]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { imgNaturalRef.current = imgNaturalSize; }, [imgNaturalSize]);

  const dragging = useRef(false);
  const dragStart = useRef({ clientX: 0, clientY: 0, translateX: 0, translateY: 0 });
  const translateRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => { onPositionChangeRef.current = onPositionChange; }, [onPositionChange]);

  // Tamaño del contenedor
  const containerSizeRef = useRef({ width: 1, height: 1 });
  const containerCallbackRef = useCallback((node) => {
    containerRef.current = node;
    if (node) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerSizeRef.current = { width: rect.width, height: rect.height };
      }
    }
  }, []);

  // ── getContainedLayout ──
  // Calcula el tamaño renderizado de la imagen con object-fit: contain
  // dentro de un elemento de tamaño (elemW, elemH).
  const getContainedLayout = useCallback((elemW, elemH, natW, natH) => {
    if (!natW || !natH || natW <= 0 || natH <= 0) {
      return { w: elemW, h: elemH, ox: 0, oy: 0 };
    }
    const fitScale = Math.min(elemW / natW, elemH / natH);
    return {
      w: natW * fitScale,
      h: natH * fitScale,
      ox: (elemW - natW * fitScale) / 2,
      oy: (elemH - natH * fitScale) / 2,
    };
  }, []);

  // Convertir posición a translate en píxeles (sin límite 0-100)
  const posToTranslate = useCallback((posX, posY, z) => {
    const { width: cw, height: ch } = containerSizeRef.current;
    const nat = imgNaturalRef.current;
    const elemW = z * cw;
    const elemH = z * ch;
    const layout = getContainedLayout(elemW, elemH, nat.w, nat.h);
    return {
      x: (cw / 2) - layout.ox - (posX * layout.w) / 100,
      y: (ch / 2) - layout.oy - (posY * layout.h) / 100,
    };
  }, [getContainedLayout]);

  // Convertir translate en píxeles a posición (SIN límite 0-100).
  // La posición puede ser menor a 0 o mayor a 100 si la imagen se
  // arrastra dejando espacio alrededor (letterbox). getImageStyle
  // reproduce cualquier valor porque object-position acepta % fuera
  // de 0-100.
  const translateToPos = useCallback((tx, ty, z) => {
    const { width: cw, height: ch } = containerSizeRef.current;
    const nat = imgNaturalRef.current;
    const elemW = z * cw;
    const elemH = z * ch;
    const layout = getContainedLayout(elemW, elemH, nat.w, nat.h);
    const posX = layout.w > 0 ? ((cw / 2) - tx - layout.ox) * 100 / layout.w : 50;
    const posY = layout.h > 0 ? ((ch / 2) - ty - layout.oy) * 100 / layout.h : 50;
    return {
      x: Math.round(posX),
      y: Math.round(posY),
    };
  }, [getContainedLayout]);

  // ── clampTranslate ──
  // El arrastre es LIBRE: la imagen puede moverse a cualquier posición,
  // incluso dejando espacio alrededor (letterbox, p.ej. a 1.0x donde el
  // contenido no cubre el contenedor), exactamente igual que lo
  // reproduce getImageStyle en los contenedores. El único límite es que
  // al menos un borde del contenido siga tocando el contenedor (nunca
  // desaparece por completo de la vista).
  const clampTranslate = useCallback((tx, ty, z) => {
    const { width: cw, height: ch } = containerSizeRef.current;
    const nat = imgNaturalRef.current;
    const layout = getContainedLayout(z * cw, z * ch, nat.w, nat.h);
    const M = 1; // margen de seguridad: un sliver siempre visible
    // rango: borde derecho del contenido → borde izquierdo del
    // contenedor, y borde izquierdo del contenido → borde derecho.
    const clampX = (v) => {
      const lo = -layout.ox - layout.w + M;
      const hi = cw - layout.ox - M;
      return Math.max(lo, Math.min(hi, v));
    };
    const clampY = (v) => {
      const lo = -layout.oy - layout.h + M;
      const hi = ch - layout.oy - M;
      return Math.max(lo, Math.min(hi, v));
    };
    return { x: clampX(tx), y: clampY(ty) };
  }, [getContainedLayout]);

  // Aplicar transform al DOM
  const applyTransform = useCallback((tx, ty) => {
    if (!imgRef.current) return;
    imgRef.current.style.transform = `translate(${tx}px, ${ty}px)`;
    translateRef.current = { x: tx, y: ty };
  }, []);

  // Posicionar desde posición y zoom, clampeando solo para que el
  // contenido no desaparezca por completo del contenedor.
  const panTo = useCallback((posX, posY, z) => {
    const t = posToTranslate(posX, posY, z);
    const c = clampTranslate(t.x, t.y, z);
    applyTransform(c.x, c.y);
    const pos = translateToPos(c.x, c.y, z);
    xRef.current = pos.x;
    yRef.current = pos.y;
  }, [posToTranslate, clampTranslate, translateToPos, applyTransform]);

  // Inicializar posición cuando la imagen carga
  const handleImgLoad = useCallback(() => {
    if (imgRef.current) {
      const nw = imgRef.current.naturalWidth || 1;
      const nh = imgRef.current.naturalHeight || 1;
      setImgNaturalSize({ w: nw, h: nh });
      imgNaturalRef.current = { w: nw, h: nh };
    }
    panTo(xRef.current, yRef.current, zoomRef.current);
  }, [panTo]);

  // ── Re-medir el contenedor cuando se vuelve visible ──
  // El editor se monta dentro de un <dialog> que arranca con
  // display:none (ModalShell lo oculta hasta showModal()). En dev,
  // React.StrictMode monta/desmonta/remonta el componente y el segundo
  // callback del ref sí mide el contenedor visible. En producción NO hay
  // doble montaje: la medición inicial da 0×0, containerSizeRef queda en
  // {1,1} y el arrastre/zoom se rompen (la imagen solo crece del centro).
  // Aquí reintentamos medir cada frame hasta obtener un tamaño estable
  // (2 frames iguales, para ignorar la animación de entrada del dialog)
  // y re-aplicamos el pan con el tamaño real.
  useEffect(() => {
    let raf = 0;
    let observer = null;
    let lastKey = '';
    let stableFrames = 0;

    // Medir y aplicar el pan. Usa offsetWidth/offsetHeight (tamaño de
    // layout, sin transforms) para no capturar la escala de la animación
    // de entrada del dialog, que sí afecta a getBoundingClientRect.
    const applyPan = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        containerSizeRef.current = { width: w, height: h };
        panTo(xRef.current, yRef.current, zoomRef.current);
      }
    };

    // Esperar un tamaño estable (2 frames iguales) para ignorar la
    // animación de entrada del dialog y el primer paint.
    const applyIfStable = () => {
      const el = containerRef.current;
      if (!el) return false;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        const key = `${w}x${h}`;
        if (key === lastKey) {
          stableFrames += 1;
          if (stableFrames >= 2) {
            applyPan();
            return true;
          }
        } else {
          lastKey = key;
          stableFrames = 0;
        }
      }
      return false;
    };

    const tick = () => {
      if (!applyIfStable()) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Re-medir en resizes (ventana / dialog) y re-aplicar el pan
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => applyPan());
      observer.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [panTo]);

  // Notificar al padre
  const notify = useCallback(() => {
    const payload = JSON.stringify({
      x: xRef.current,
      y: yRef.current,
      zoom: Math.round(zoomRef.current * 10) / 10,
    });
    onPositionChangeRef.current?.(payload);
  }, []);

  // ── Drag (1:1 píxel a píxel) ──
  const updateDrag = useCallback((clientX, clientY) => {
    const d = dragStart.current;
    const dx = clientX - d.clientX;
    const dy = clientY - d.clientY;
    const newTx = d.translateX + dx;
    const newTy = d.translateY + dy;

    // Arrastre libre (sin límite de 0-100): la imagen puede dejar
    // espacio alrededor; solo se evita que desaparezca por completo.
    const z = zoomRef.current;
    const c = clampTranslate(newTx, newTy, z);
    applyTransform(c.x, c.y);

    const pos = translateToPos(c.x, c.y, z);
    xRef.current = pos.x;
    yRef.current = pos.y;
  }, [applyTransform, clampTranslate, translateToPos]);

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
    dragging.current = true;
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      translateX: translateRef.current.x,
      translateY: translateRef.current.y,
    };
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
    const touch = e.touches[0];
    dragging.current = true;
    dragStart.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      translateX: translateRef.current.x,
      translateY: translateRef.current.y,
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  }, [handleTouchMove, handleTouchEnd]);

  // Cleanup
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  // ── Reset cuando cambia la imagen ──
  const prevUrlRef = useRef(imageUrl);
  useEffect(() => {
    if (imageUrl !== prevUrlRef.current) {
      prevUrlRef.current = imageUrl;
      // Reset a centro y zoom=1 para que la NUEVA imagen se vea completa
      setX(50);
      setY(50);
      setZoom(1);
      xRef.current = 50;
      yRef.current = 50;
      zoomRef.current = 1;
      // Limpiar translate del DOM para que la nueva imagen no herede
      // la posicion de la anterior (evita flash visual)
      if (imgRef.current) {
        imgRef.current.style.transform = '';
        translateRef.current = { x: 0, y: 0 };
      }
      // El translate lo aplica handleImgLoad cuando la imagen cargue
    }
  }, [imageUrl]);

  // ── Zoom ──
  const handleZoomChange = useCallback((e) => {
    const z = parseFloat(e.target.value);
    setZoom(z);
    zoomRef.current = z;
    panTo(xRef.current, yRef.current, z);
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
    panTo(50, 50, 1);
    notify();
  }, [panTo, notify]);

  if (!imageUrl) return null;

  const borderRadius = circular ? '50%' : 'var(--radius-sm, 6px)';
  const z = zoom;

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
          lineHeight: 0,
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
            width: `${z * 100}%`,
            height: `${z * 100}%`,
            maxWidth: 'none',
            maxHeight: 'none',
            objectFit: 'contain',
            transformOrigin: 'center center',
            pointerEvents: 'none',
          }}
          onLoad={handleImgLoad}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      </div>

      {/* ── Controls row ── */}
      <div className="fc-modal-range-row" style={{ gap: 6 }}>
        <FaSearchMinus style={{ fontSize: '0.72rem', opacity: 0.5, flexShrink: 0 }} />
        <div className="fc-modal-range-control" style={{ flex: 1 }}>
          <input
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={zoom}
            onChange={handleZoomChange}
            onMouseUp={handleZoomCommit}
            onTouchEnd={handleZoomCommit}
            className="fc-modal-range"
          />
        </div>
        <FaSearchPlus style={{ fontSize: '0.72rem', opacity: 0.5, flexShrink: 0 }} />
        <span className="fc-modal-range-value" style={{ minWidth: 32 }}>
          {zoom.toFixed(1)}x
        </span>
        <button
          type="button"
          onClick={handleReset}
          className="fc-modal-sub-cancel"
          style={{
            fontSize: '0.7rem',
            padding: '2px 10px',
            lineHeight: '20px',
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
