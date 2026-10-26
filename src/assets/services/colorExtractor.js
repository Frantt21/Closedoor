/**
 * Color Extraction Utility
 *
 * Extracts dominant colors from any image URL using:
 * 1. Direct fetch (for CORS-friendly sources like Supabase)
 * 2. wsrv.nl image proxy (for CORS-blocked sources like Pinterest)
 * 3. Frequency-based color sampling + weighted merging
 *
 * Results are cached in localStorage so extraction only happens once per URL.
 */

// ── Configuration ──

const CORS_SAFE_DOMAINS = [
  'supabase.co',
  'supabase.in',
  'githubusercontent.com',
  'images.unsplash.com',
  'cdn.discordapp.com',
];

// Domains that block CORS or hotlinking — skip direct fetch to avoid console
// errors and go straight to a proxy. wallhaven devuelve 403 al navegador y
// wsrv.nl lo bloquea por política → se resuelve con el proxy propio.
const CORS_BLOCKED_DOMAINS = [
  'pinimg.com',
  'pinterest.com',
  'fbcdn.net',
  'instagram.com',
  'cdninstagram.com',
  'wallhaven.cc',
  'imgur.com',
];

// Image proxy that resizes + serves with proper CORS headers
const IMAGE_PROXY = 'https://wsrv.nl/?';

const CACHE_KEY_PREFIX = 'fc_colors_';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours (but the user suggested 5 min, let's do 1 week since we don't need to delete anything)
// Actually, cache is fine for a long time since colors don't change per URL

import { getItem, setItem } from './secureStorage';

// ── Cache ──

function getCachedColors(imageUrl) {
  try {
    const entry = getItem(CACHE_KEY_PREFIX + imageUrl);
    if (!entry || !entry.colors || !entry.ts) return null;
    // No TTL check — if cached, it's valid. User can clear cache manually.
    return entry.colors;
  } catch {
    return null;
  }
}

function setCachedColors(imageUrl, colors) {
  try {
    setItem(CACHE_KEY_PREFIX + imageUrl, {
      colors,
      ts: Date.now(),
    });
  } catch {
    // localStorage might be full, ignore
  }
}

// ── Domain matching ──

function matchesDomain(url, domains) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return domains.some((d) => hostname.endsWith(d) || hostname === d);
  } catch {
    return false;
  }
}

// ── Fetch helpers ──

async function fetchImageAsBlob(url, timeoutMs = 8000) {
  const response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.size < 100) throw new Error('Image too small');
  return blob;
}

/**
 * Generate a proxied URL via wsrv.nl — resizes image + adds CORS headers
 *
 * IMPORTANT: wsrv.nl requires a full absolute URL (with protocol + hostname).
 * If the URL is relative (e.g. "/cdn/files/xxx"), we prepend the current
 * window.location.origin so the proxy can fetch it correctly.
 */
function proxyViaWsrv(originalUrl) {
  let absoluteUrl = originalUrl;
  if (absoluteUrl && !absoluteUrl.startsWith('http://') && !absoluteUrl.startsWith('https://')) {
    // Relative URL → make it absolute using the current origin
    absoluteUrl = window.location.origin + (absoluteUrl.startsWith('/') ? absoluteUrl : '/' + absoluteUrl);
  }
  const params = new URLSearchParams({
    url: absoluteUrl,
    w: '200',      // Resize to 200px wide (plenty for color extraction)
    output: 'webp', // WebP is smaller, faster to download
    q: '60',       // Quality 60% — good enough for colors
  });
  return `${IMAGE_PROXY}${params.toString()}`;
}

/**
 * Proxy de imágenes PROPIO (vía el backend: /api/image-proxy → music server).
 * Algunos dominios (wallhaven) bloquean el fetch del navegador por CORS/hotlink
 * Y además wsrv.nl los bloquea por política. El server baja la imagen SIN
 * Origin header (esos dominios responden 200 a curl) y la devuelve con CORS *
 * → el navegador puede leerla para extraer colores.
 * Ruta relativa: funciona en producción (rewrite de Vercel) y en dev (proxy de
 * Vite) — no depende de un servicio de terceros con políticas de bloqueo.
 */
function proxyViaSelf(originalUrl) {
  return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
}

function loadBlobAndExtract(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const colors = extractDominantColors(img);
        URL.revokeObjectURL(url);
        resolve(colors);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load blob image'));
    };
    img.src = url;
  });
}

// ── Main export ──

/**
 * Extract 4 dominant colors from an image URL.
 * Uses browser cache + localStorage cache to avoid repeated downloads.
 */
const FALLBACK_COLORS = ['#ffffff', '#555555', '#222222', '#000000'];

/**
 * `true` si la paleta es el RESPALDO de un fallo de lectura, no colores reales.
 *
 * El algoritmo descarta los píxeles casi blancos (r,g,b > 245), así que
 * '#ffffff' como PRIMER color no puede salir de una imagen: solo está en
 * FALLBACK_COLORS. Sirve para no pintar con gris un acento inexistente y para
 * invalidar entradas de caché envenenadas por un fallo anterior.
 */
function isFallbackPalette(colors) {
  return !Array.isArray(colors) || colors.length === 0 || colors[0] === FALLBACK_COLORS[0];
}

// URLs que fallaron hace poco: evita repetir los 3 intentos (directo → proxy
// propio → wsrv) cada vez que se abre un chat con un fondo ilegible. Es solo un
// cooldown en memoria, así que un arreglo de red entra en vigor al minuto.
const recentFailures = new Map(); // url → timestamp
const FAILURE_COOLDOWN = 60 * 1000;

export async function extractColors(imageUrl) {
  if (!imageUrl) return [...FALLBACK_COLORS];

  // Check localStorage cache first. Una entrada con la paleta de respaldo es un
  // fallo cacheado (versiones anteriores sí la guardaban) → se ignora y se
  // reintenta, en vez de arrastrar "sin acento" para siempre en esa imagen.
  const cached = getCachedColors(imageUrl);
  if (cached && !isFallbackPalette(cached)) return cached;

  const failedAt = recentFailures.get(imageUrl);
  if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN) return [...FALLBACK_COLORS];

  let colors;

  if (matchesDomain(imageUrl, CORS_SAFE_DOMAINS)) {
    // CORS-safe → fetch directly
    colors = await attemptExtraction(imageUrl);
  } else if (matchesDomain(imageUrl, CORS_BLOCKED_DOMAINS)) {
    // CORS-blocked/hotlink → proxy propio primero (sin política de bloqueo),
    // wsrv como respaldo (resize + CORS para Pinterest/Instagram, etc.).
    colors = await attemptExtraction(proxyViaSelf(imageUrl))
      || await attemptExtraction(proxyViaWsrv(imageUrl));
  } else {
    // Unknown → direct first, then own proxy, then wsrv
    colors = await attemptExtraction(imageUrl)
      || await attemptExtraction(proxyViaSelf(imageUrl))
      || await attemptExtraction(proxyViaWsrv(imageUrl));
  }

  // Sin lectura posible (CORS, red, timeout, CSP): se devuelve el respaldo pero
  // NO se cachea, para que un reintento posterior (proxy disponible, red
  // arreglada…) pueda dar colores reales en lugar de quedar fijado el fallo.
  if (!colors) {
    recentFailures.set(imageUrl, Date.now());
    return [...FALLBACK_COLORS];
  }

  recentFailures.delete(imageUrl);
  setCachedColors(imageUrl, colors);
  return colors;
}

// ── Contrast color for background images ──

/**
 * Analyze a background image URL and determine if text should be light or dark.
 * Returns '#000000' for light/bright images, '#ffffff' for dark images.
 * Uses the cached dominant color from extractColors.
 */
export async function getContrastForBg(imageUrl) {
  if (!imageUrl) return '#ffffff';
  const colors = await extractColors(imageUrl);
  if (!colors || colors.length === 0) return '#ffffff';
  // Use the most dominant color to determine contrast
  return getContrastFromHex(colors[0]);
}

/**
 * Given a hex color, return the ideal text contrast color.
 * Returns '#000000' for light backgrounds, '#ffffff' for dark backgrounds.
 * Standalone version so colorExtractor doesn't depend on helpers.js.
 */
export function getContrastFromHex(hex) {
  if (!hex) return '#ffffff';
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
    return '#ffffff';
  }
  const srgb = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  // Threshold raised to 0.3 so only truly light backgrounds (not mid-tones)
  // trigger dark text. Mid-tone colors like rose/pink keep white text.
  return luminance > 0.3 ? '#000000' : '#ffffff';
}

/**
 * Parsea '#rgb' / '#rrggbb' a { r, g, b }. Devuelve null si no es un hex
 * válido (p. ej. un 'var(--x)' o una cadena vacía).
 */
function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.trim().replace('#', '');
  const expand = (value) => (value.length === 3
    ? value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
    : value);
  const full = expand(h);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Oscurece un color hex mezclándolo con negro.
 * amount = 0 → el mismo color, amount = 1 → negro.
 *
 * Se usa para teñir superficies (cabecera/input del chat) con el acento
 * extraído de una imagen sin perder legibilidad del texto blanco. Devuelve ''
 * si el color de entrada no es un hex válido (el CSS cae a su valor por
 * defecto con `var(--x, fallback)`).
 */
export function darkenHex(hex, amount = 0.6) {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const k = Math.min(Math.max(Number(amount) || 0, 0), 1);
  const channel = (c) => Math.round(c * (1 - k)).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/**
 * Mezcla dos colores hex: devuelve `a` con peso `weightA` sobre `b`.
 * weightA = 0 → b, weightA = 1 → a. Devuelve '' si algún hex no es válido.
 *
 * Se usa para teñir una superficie oscura con el acento sin perderlo: oscurecer
 * el acento hacia negro (darkenHex) apaga el tono y la superficie acaba viéndose
 * gris; mezclarlo con el fondo del tema mantiene el color reconocible.
 */
export function mixHex(hexA, hexB, weightA = 0.5) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return '';
  const k = Math.min(Math.max(Number(weightA) || 0, 0), 1);
  const channel = (ca, cb) => Math.round(ca * k + cb * (1 - k)).toString(16).padStart(2, '0');
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** Luminancia relativa (WCAG) de un color hex, 0 = negro, 1 = blanco. */
function relativeLuminance(rgb) {
  const srgb = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * srgb(rgb.r) + 0.7152 * srgb(rgb.g) + 0.0722 * srgb(rgb.b);
}

/**
 * Oscurece un hex lo justo para que el texto BLANCO encima siga teniendo
 * contraste suficiente (luminancia relativa <= maxLuminance, 0.16 ≈ contraste
 * 4.7:1 sobre blanco). Con acentos claros (amarillo, cian) el tinte directo
 * dejaría el texto ilegible; aquí se mantiene el TONO y se baja el brillo por
 * pasos del 6 %. Devuelve '' si el hex no es válido.
 */
export function ensureDarkSurface(hex, maxLuminance = 0.16) {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  let current = rgb;
  const limit = Math.min(Math.max(Number(maxLuminance) || 0, 0), 1);
  for (let i = 0; i < 24 && relativeLuminance(current) > limit; i++) {
    current = { r: current.r * 0.94, g: current.g * 0.94, b: current.b * 0.94 };
  }
  const channel = (c) => Math.round(c).toString(16).padStart(2, '0');
  return `#${channel(current.r)}${channel(current.g)}${channel(current.b)}`;
}

/**
 * hex → 'rgba(r, g, b, a)', para bordes/velos translúcidos del mismo acento.
 * Devuelve '' si el hex no es válido.
 */
export function hexToRgba(hex, alpha = 1) {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const a = Math.min(Math.max(Number(alpha) || 0, 0), 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

/**
 * Try to fetch and extract colors from a URL. Returns null on failure.
 */
async function attemptExtraction(url) {
  try {
    const blob = await fetchImageAsBlob(url);
    return await loadBlobAndExtract(blob);
  } catch {
    return null;
  }
}

// ── Color extraction algorithm ──
// Frequency-based sampling + weighted merging
// No hue shifting — colors stay true to the source image

function extractDominantColors(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // 200px is plenty for color analysis
  const MAX_SIZE = 200;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  canvas.width = Math.max(width, 1);
  canvas.height = Math.max(height, 1);

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  // Sample every pixel with fine quantization (8 levels)
  const QUANTIZE_LEVELS = 8;
  const colorMap = new Map();

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    if (a < 128) continue;
    if (r < 15 && g < 15 && b < 15) continue;  // near-black
    if (r > 245 && g > 245 && b > 245) continue; // near-white (likely overlay)

    const qr = quantize(r, QUANTIZE_LEVELS);
    const qg = quantize(g, QUANTIZE_LEVELS);
    const qb = quantize(b, QUANTIZE_LEVELS);
    const key = `${qr},${qg},${qb}`;

    const entry = colorMap.get(key);
    if (entry) {
      entry.count++;
    } else {
      colorMap.set(key, { r: qr, g: qg, b: qb, count: 1 });
    }
  }

  if (colorMap.size === 0) {
    return ['#ffffff', '#555555', '#222222', '#000000'];
  }

  // Sort by frequency (most common colors first)
  const sorted = Array.from(colorMap.values()).sort((a, b) => b.count - a.count);

  // Merge similar colors (weighted average)
  const MERGE_THRESHOLD = 35;
  const merged = [];

  for (const color of sorted) {
    let matched = false;

    for (const existing of merged) {
      const dist = colorDistance(
        { r: color.r, g: color.g, b: color.b },
        { r: existing.r, g: existing.g, b: existing.b }
      );

      if (dist < MERGE_THRESHOLD) {
        const total = existing.count + color.count;
        existing.r = Math.round((existing.r * existing.count + color.r * color.count) / total);
        existing.g = Math.round((existing.g * existing.count + color.g * color.count) / total);
        existing.b = Math.round((existing.b * existing.count + color.b * color.count) / total);
        existing.count = total;
        matched = true;
        break;
      }
    }

    if (!matched) {
      merged.push({ ...color });
    }

    if (merged.length >= 6) break;
  }

  merged.sort((a, b) => b.count - a.count);

  // Take top 4 and convert to hex
  const top4 = merged.slice(0, 4).map((c) => rgbToHex(c));

  // Fill missing slots
  while (top4.length < 4) {
    if (top4.length === 1) top4.push('#666666');
    else if (top4.length === 2) top4.push('#333333');
    else top4.push('#999999');
  }

  // Gentle lightness adjustment only (no hue shift)
  return adjustLightness(top4);
}

function adjustLightness(colors) {
  const result = [...colors];

  for (let i = 1; i < result.length; i++) {
    let tooSimilar = false;
    for (let j = 0; j < i; j++) {
      if (hexDelta(result[i], result[j]) < 20) {
        tooSimilar = true;
        break;
      }
    }

    if (tooSimilar) {
      const hsl = hexToHsl(result[i]);
      // Only adjust lightness — NEVER touch hue
      hsl.l = Math.max(15, Math.min(85, hsl.l + (i % 2 === 0 ? 20 : -15)));
      result[i] = hslToHex(hsl);
    }
  }

  return result;
}

// ── Color math ──

function quantize(value, levels) {
  const step = Math.floor(256 / levels);
  return Math.round(Math.floor(value / step) * step + step / 2);
}

function colorDistance(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function hexDelta(hex1, hex2) {
  return colorDistance(hexToRgb(hex1), hexToRgb(hex2));
}

function rgbToHex({ r, g, b }) {
  const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 128, g: 128, b: 128 };
}

function hexToHsl(hex) {
  let { r, g, b } = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return rgbToHex({ r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) });
}
