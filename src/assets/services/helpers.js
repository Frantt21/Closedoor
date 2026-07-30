// ── Constants ──
export const DEFAULT_AVATAR =
  'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';

export const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$|\/cdn\/files\//i;
export const VID_RE = /\.(mp4|webm|ogg)(\?.*)?$/i;
export const VID_RE_EXTENDED = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i;

export const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;
export const YOUTUBE_PATTERN = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
export const VIMEO_PATTERN = /vimeo\.com\/(\d+)/;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── UUID detection ──
export function isUUID(str) {
  return UUID_RE.test(str);
}

// ── Relative time formatting ──
export function getTimeAgo(t, locale, dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t('post.just_now');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('post.minutes_ago', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('post.hours_ago', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t('post.days_ago', { n: diffDay });
  return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric',
    month: 'short',
  });
}

// ── WCAG contrast text color ──
export function getContrastText(hex) {
  if (!hex) return '#000000';
  let r, g, b;
  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    return '#000000';
  }
  const srgb = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

// ── Extract URLs from text (absolute HTTP URLs + relative CDN paths) ──
export function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_PATTERN) || [];
  // También extraer rutas relativas del CDN: /cdn/files/xxx
  const cdnMatches = text.match(/\/cdn\/files\/[^\s<]+/gi) || [];
  // Combinar y deduplicar
  const all = [...matches];
  for (const cdn of cdnMatches) {
    if (!all.includes(cdn)) all.push(cdn);
  }
  return all;
}

// ── Detect media type from text content (auto-detection) ──
export function detectMediaFromContent(text) {
  const urls = extractUrls(text);
  let imageUrl = null;
  let videoUrl = null;

  for (const url of urls) {
    if (videoUrl && imageUrl) break;
    if (!videoUrl && (VID_RE.test(url) || YOUTUBE_PATTERN.test(url) || VIMEO_PATTERN.test(url))) {
      videoUrl = url;
    }
    if (!imageUrl && IMG_RE.test(url)) {
      imageUrl = url;
    }
  }

  return { imageUrl, videoUrl };
}

// ── Get embed URL for YouTube/Vimeo ──
export function getEmbedUrl(url) {
  if (!url) return null;
  const yt = url.match(YOUTUBE_PATTERN);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(VIMEO_PATTERN);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

// ── Check if URL is a video ──
export function isVideoUrl(url) {
  if (!url) return false;
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
  const lower = url.toLowerCase();
  return videoExts.some((ext) => lower.includes(ext)) || lower.includes('youtube.com') || lower.includes('youtu.be') || lower.includes('vimeo.com');
}

// ── Image position helpers (avatar/banner transforms) ──

/**
 * Parse a position string (legacy "X% Y%" or JSON "{"x":50,"y":50,"zoom":1,"rotation":0,"flipX":false,"flipY":false}")
 * and return a normalized position object.
 */
export function parseImagePosition(pos) {
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

/**
 * Like getImgTransformStyle but WITHOUT scale/zoom — for use on <Avatar>
 * elements where the scale transform would make the avatar look larger.
 * Only applies objectPosition for positioning + rotation/flip (no zoom).
 */
export function getAvatarTransformStyle(positionStr) {
  const p = parseImagePosition(positionStr || '');
  const transforms = [];
  if (p.rotation !== 0) transforms.push(`rotate(${p.rotation}deg)`);
  if (p.flipX) transforms.push('scaleX(-1)');
  if (p.flipY) transforms.push('scaleY(-1)');

  const style = {
    objectPosition: `${p.x}% ${p.y}%`,
  };
  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
  }
  return style;
}

/**
 * Given a position string, return the style object for an <img> element
 * with object-fit: cover.
 *
 * ⚠️ NO usa transform: scale(Z) porque combinado con object-fit: cover
 *    produce clipping/distorsión impredecible en distintos navegadores.
 *    En su lugar, aplica el zoom mediante `width` y `height` en %,
 *    que scalea el área visible del img dentro del contenedor.
 *
 * Incluye objectPosition (focal point X/Y) y CSS transform para
 * rotation y flip (scaleX/scaleY).
 *
 * El contenedor PADRE debe tener overflow: hidden para recortar
 * el exceso de imagen cuando zoom > 1.
 */
export function getImgTransformStyle(positionStr) {
  const p = parseImagePosition(positionStr || '');
  const transforms = [];
  // ❌ Eliminado: transform: scale() — usar width/height en % abajo
  if (p.rotation !== 0) transforms.push(`rotate(${p.rotation}deg)`);
  if (p.flipX) transforms.push('scaleX(-1)');
  if (p.flipY) transforms.push('scaleY(-1)');

  const style = {
    objectPosition: `${p.x}% ${p.y}%`,
  };
  // Zoom mediante dimensiones reales del img (no transform) para respetar object-fit
  if (p.zoom !== 1) {
    style.width = `${p.zoom * 100}%`;
    style.height = `${p.zoom * 100}%`;
    style.maxWidth = 'none';
  }
  if (transforms.length > 0) {
    style.transform = transforms.join(' ');
  }
  return style;
}

/**
 * Given a position string, return just the background-position value
 * (for use with CSS background-image on a div).
 */
export function getBgPositionStyle(positionStr) {
  const p = parseImagePosition(positionStr || '');
  return `${p.x}% ${p.y}%`;
}

/**
 * Given a position string, return the full set of styles for a <div>
 * that renders an image via background-image. Includes background-position,
 * background-size (for zoom), and CSS transform (for rotation/flip).
 *
 * Use this on a dedicated inner <div> (not the container) so transforms
 * don't affect sibling elements like overlay, avatar, etc.
 */
export function getBgFullStyle(positionStr) {
  const p = parseImagePosition(positionStr || '');
  const transforms = [];
  if (p.rotation !== 0) transforms.push(`rotate(${p.rotation}deg)`);
  if (p.flipX) transforms.push('scaleX(-1)');
  if (p.flipY) transforms.push('scaleY(-1)');

  return {
    backgroundPosition: `${p.x}% ${p.y}%`,
    backgroundSize: `${(p.zoom * 100).toFixed(1)}%`,
    ...(transforms.length > 0 ? { transform: transforms.join(' ') } : {}),
  };
}
