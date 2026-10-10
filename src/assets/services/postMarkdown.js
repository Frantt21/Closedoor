// Lógica de markdown para posts (sin JSX) para poder testearla con Node.
//
// Se usa desde PostMarkdown.jsx a través de react-markdown.

// Menciones @user y hashtags #tag (mismo criterio que RichText).
// Ojo: en markdown `#` solo es título si le sigue un espacio, así que
// `#Hashtag` sigue siendo un hashtag y esta sintaxis no se rompe.
const MENTION_TAG_REGEX = /(?<![\w@])(@[a-zA-Z0-9_]+)|(?<![#\w])#([a-zA-Z0-9_\u00C0-\u024F]+)/gu;

// No descendemos en estos nodos: dentro de código/imágenes/links no se
// convierten menciones ni hashtags.
const SKIP_NODES = new Set(['code', 'inlineCode', 'link', 'image', 'html']);

function splitTextNode(value) {
  const nodes = [];
  let last = 0;
  MENTION_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = MENTION_TAG_REGEX.exec(value)) !== null) {
    if (match.index > last) {
      nodes.push({ type: 'text', value: value.slice(last, match.index) });
    }
    const token = match[0];
    const isMention = token.startsWith('@');
    nodes.push({
      type: 'link',
      url: isMention
        ? `/profile/${token.slice(1)}`
        : `/hashtag/${encodeURIComponent(token.slice(1))}`,
      children: [{ type: 'text', value: token }],
    });
    last = match.index + token.length;
  }
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes.length > 0 ? nodes : [{ type: 'text', value }];
}

/**
 * Plugin remark: convierte @menciones y #hashtags dentro de los nodos de texto
 * en links internos (`/profile/x`, `/hashtag/x`) para que el renderer los
 * pinte igual que RichText.
 */
export function remarkMentionsAndTags() {
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    if (SKIP_NODES.has(node.type)) return;
    const nextChildren = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        nextChildren.push(...splitTextNode(child.value));
      } else {
        walk(child);
        nextChildren.push(child);
      }
    }
    node.children = nextChildren;
  };
  return (tree) => walk(tree);
}

/**
 * Calcula el texto y la nueva selección al aplicar formato markdown desde la
 * toolbar del composer, sin insertar texto de relleno:
 *
 * - inline (negrita, cursiva…): envuelve la selección y la deja seleccionada;
 *   si no hay selección, deja el cursor dentro del par.
 * - bloque (listas, citas): prefija las líneas que tocan la selección (como los
 *   editores de markdown), no inserta desde la posición del cursor.
 *
 * @returns {{ next: string, selectionStart: number, selectionEnd: number }}
 */
export function applyMarkdownEdit({ value = '', start = 0, end = 0, prefix = '', suffix = '', block = false }) {
  if (block) {
    // Líneas afectadas por la selección
    const lineStart = value.lastIndexOf('\n', Math.max(start - 1, -1)) + 1;
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;

    const blockText = value.slice(lineStart, lineEnd);
    const inserted = blockText.split('\n').map((line) => `${prefix}${line}`).join('\n');

    return {
      next: value.slice(0, lineStart) + inserted + value.slice(lineEnd),
      selectionStart: lineStart + prefix.length,
      selectionEnd: lineStart + inserted.length,
    };
  }

  const selected = value.slice(start, end);
  const inserted = `${prefix}${selected}${suffix}`;

  return {
    next: value.slice(0, start) + inserted + value.slice(end),
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selected.length,
  };
}

/**
 * Cierra los marcadores inline que quedaron abiertos al truncar el texto,
 * para que un `**negrita` cortado no se vea literal en el feed.
 */
export function closeUnbalancedMarkers(text) {
  let inCode = false;
  let inBold = false;
  let inStrike = false;
  let singleStars = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') { i++; continue; }
    if (char === '`') { inCode = !inCode; continue; }
    if (inCode) continue;
    if (char === '*' && text[i + 1] === '*') { inBold = !inBold; i++; continue; }
    if (char === '*') { singleStars++; continue; }
    if (char === '~' && text[i + 1] === '~') { inStrike = !inStrike; i++; continue; }
  }
  let closers = '';
  if (inCode) closers += '`';
  if (inBold) closers += '**';
  if (inStrike) closers += '~~';
  if (singleStars % 2 === 1) closers += '*';
  return text + closers;
}
