/**
 * make-desktop-icons — genera los iconos de la app de escritorio desde el asset
 * de marca del proyecto.
 *
 *   node scripts/make-desktop-icons.mjs [fuente.png|fuente.svg]
 *
 * Fuente por defecto: `public/mini_icon.png` — el tile cuadrado de la marca
 * (100% opaco, con su propio fondo, así que se ve igual en barras claras y
 * oscuras). También acepta un `.svg` y usa su PNG embebido.
 *
 * ⚠️ NO usar `public/logo.svg` para esto: medido, el PNG que embebe es un trazo
 * blanco finísimo (0,59% de píxeles con alpha > 8, alpha máximo 200) pensado
 * para el header/loader sobre fondo oscuro; a 32 px desaparece.
 *
 * Salida:
 *   desktop/assets/icon.png   512×512  ventana/taskbar + instalador (electron-builder saca el .ico/.icns)
 *   desktop/assets/tray.png    32×32   icono de la bandeja del sistema
 *
 * ¿Por qué en Node puro y no con `nativeImage` de Electron? Medido: al construir
 * desde un bitmap, Electron aplica el factor de escala de la pantalla (en un
 * equipo al 250% el PNG de 512 salía de 1280×1280 y el de 32 quedaba con alpha
 * máximo 9, es decir INVISIBLE). Aquí el remuestreo y la codificación son
 * deterministas: el mismo archivo en cualquier máquina, y al final se re-decodifica
 * el archivo escrito para comprobar que el arte no se perdió.
 *
 * El arte se recorta al bounding box del alpha y se centra en un cuadrado. Si el
 * asset es "a sangre" (tile que ocupa todo el marco) no se añade margen; si tiene
 * transparencia alrededor, se añade uno pequeño.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'public', 'mini_icon.png');
const OUT_DIR = path.join(ROOT, 'desktop', 'assets');

// [archivo, lado] — el margen se calcula según el asset (ver hasBleed).
const TARGETS = [
  ['icon.png', 512],
  ['tray.png', 32],
];

// ── PNG: lectura ────────────────────────────────────────────────
function decodePng(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`PNG no soportado (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`);
  }

  const idat = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride); // RGBA si hace falta
  const outChannels = 4;
  let prev = Buffer.alloc(stride);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[o++];
    const line = Buffer.from(raw.subarray(o, o + stride));
    o += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pr) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      // ⚠️ El índice de destino depende de x: sin el `+ x` todas las filas
      // escribían en el mismo píxel y el decodificador devolvía basura casi
      // transparente (los iconos salían invisibles).
      const d = (y * width + x) * outChannels;
      px[d] = line[s];
      px[d + 1] = channels >= 3 ? line[s + 1] : line[s];
      px[d + 2] = channels >= 3 ? line[s + 2] : line[s];
      px[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: px, channels: outChannels };
}

// ── PNG: escritura ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0])); // filtro 0 (none)
    rows.push(Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Remuestreo (box filter con alpha premultiplicado) ────────────
function downscale(src, sx, sy, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = sy + Math.floor((dy * sh) / dh);
    const y1 = Math.max(y0 + 1, sy + Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = sx + Math.floor((dx * sw) / dw);
      const x1 = Math.max(x0 + 1, sx + Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, alphaSum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          const a = src.data[i + 3];
          r += src.data[i] * a;
          g += src.data[i + 1] * a;
          b += src.data[i + 2] * a;
          alphaSum += a;
          n++;
        }
      }
      const o = (dy * dw + dx) * 4;
      if (alphaSum > 0) {
        out[o] = Math.round(r / alphaSum);
        out[o + 1] = Math.round(g / alphaSum);
        out[o + 2] = Math.round(b / alphaSum);
        out[o + 3] = Math.round(alphaSum / n);
      }
    }
  }
  return out;
}

/** Bounding box de los píxeles con alpha > 8. */
function alphaBox(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('el logo está totalmente transparente');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Métricas de un PNG ya codificado (para no publicar un icono invisible). */
function alphaStats(img) {
  let opaque = 0, maxAlpha = 0, lumSum = 0, lumCount = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const a = img.data[i * 4 + 3];
    if (a > maxAlpha) maxAlpha = a;
    if (a >= 200) opaque++;
    if (a >= 32) {
      lumSum += 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
      lumCount++;
    }
  }
  return { opaque, maxAlpha, avgLuminance: lumCount ? +(lumSum / lumCount).toFixed(1) : null };
}

// ── Generación ──────────────────────────────────────────────────
const sourceBytes = fs.readFileSync(SOURCE);
let pngBuffer = sourceBytes;
if (SOURCE.toLowerCase().endsWith('.svg')) {
  const embedded = sourceBytes.toString('utf8').match(/base64,([A-Za-z0-9+/=]+)/);
  if (!embedded) throw new Error(`${SOURCE} no tiene un PNG embebido en base64`);
  pngBuffer = Buffer.from(embedded[1], 'base64');
}

const logo = decodePng(pngBuffer);
const box = alphaBox(logo);
// "A sangre": el arte ocupa el marco completo (tile con su propio fondo).
const hasBleed = box.width >= logo.width * 0.98 && box.height >= logo.height * 0.98;
console.log(
  `${path.relative(ROOT, SOURCE)}: ${logo.width}×${logo.height} · arte (alpha): ${box.width}×${box.height} ` +
    `en (${box.x},${box.y}) · ${hasBleed ? 'a sangre (sin margen)' : 'con transparencia (margen)'}`
);

fs.mkdirSync(OUT_DIR, { recursive: true });

let failed = false;
for (const [name, size] of TARGETS) {
  const margin = hasBleed ? 0 : 0.06;
  const inner = Math.max(1, Math.round(size * (1 - margin * 2)));
  const scale = Math.min(inner / box.width, inner / box.height);
  const artW = Math.max(1, Math.round(box.width * scale));
  const artH = Math.max(1, Math.round(box.height * scale));
  const art = downscale(logo, box.x, box.y, box.width, box.height, artW, artH);

  const canvas = Buffer.alloc(size * size * 4, 0); // BGRA/RGBA transparente
  const offX = Math.floor((size - artW) / 2);
  const offY = Math.floor((size - artH) / 2);
  for (let y = 0; y < artH; y++) {
    art.copy(canvas, ((y + offY) * size + offX) * 4, y * artW * 4, (y + 1) * artW * 4);
  }

  const png = encodePng(size, size, canvas);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, png);

  // Re-decodificación del archivo escrito: si el arte se perdió, esto lo caza.
  const check = decodePng(fs.readFileSync(out));
  const stats = alphaStats(check);
  const ok = check.width === size && check.height === size && stats.opaque > 0;
  if (!ok) failed = true;
  const fidelity = stats.avgLuminance !== null && stats.avgLuminance > 60 ? '✅' : '⚠️ ';
  console.log(
    `${ok ? '✅' : '❌'} ${path.relative(ROOT, out)} — ${check.width}×${check.height}, ` +
      `${png.length} bytes, ${stats.opaque} px opacos, alpha máx ${stats.maxAlpha}, ` +
      `${fidelity} luminancia ${stats.avgLuminance ?? '—'} (si es < 60 el icono es casi negro: poco contraste en barras oscuras)`
  );
}

if (failed) {
  console.error('❌ algún icono salió vacío o con transparencia rota');
  process.exitCode = 1;
}
