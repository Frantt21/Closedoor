/**
 * Vercel serverless function that fetches a URL and extracts OG meta tags
 * for link previews in chats, comments, etc.
 *
 * Usage:  GET /api/og-link?url=https://example.com/some-article
 *
 * Returns:  JSON { success, title, description, image, url, favicon }
 *           or JSON { success: false, error: "..." }
 *
 * Security:
 *   - Only http/https URLs allowed
 *   - 5-second timeout
 *   - Returns only first 200KB of response body
 *   - No redirect following to file://, ftp://, etc.
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const targetUrl = req.query?.url;
  if (!targetUrl) {
    res.status(400).json({ success: false, error: 'Missing ?url parameter' });
    return;
  }

  // Validate URL
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).json({ success: false, error: 'Invalid URL' });
    return;
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ success: false, error: 'Only http/https URLs are allowed' });
    return;
  }

  // Block private IPs and localhost for security
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.') ||
    hostname.startsWith('192.168.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    res.status(400).json({ success: false, error: 'Invalid host' });
    return;
  }

  // ── Try known oEmbed providers first (more reliable than scraping OG tags) ──
  const oembedResult = await tryOembed(targetUrl, parsed);
  if (oembedResult) {
    return res.status(200).json({
      success: true,
      ...oembedResult,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  }

  // ── Fallback: scrape OG tags from the HTML ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(200).json({
        success: true,
        title: parsed.hostname,
        description: `Status ${response.status}`,
        image: null,
        url: targetUrl,
        favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
      });
    }

    // Read only first 200KB to avoid huge payloads
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    const maxBytes = 200 * 1024;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel();
    const html = new TextDecoder('utf-8').decode(
      chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
    );

    const og = extractOG(html, targetUrl);

    return res.status(200).json({
      success: true,
      ...og,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  } catch (err) {
    const fallback = getFallback(parsed, err);
    return res.status(200).json({
      success: true,
      ...fallback,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  }
}

/**
 * Try to fetch metadata via known oEmbed providers.
 * Returns null if no oEmbed provider matched or the request failed.
 */
async function tryOembed(targetUrl, parsed) {
  const hostname = parsed.hostname.toLowerCase();

  // ── Spotify oEmbed ──
  if (hostname === 'open.spotify.com' || hostname === 'spotify.link') {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`;
      const resp = await fetch(oembedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ClosedoorBot/1.0)',
          'Accept': 'application/json',
        },
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        // Strip HTML tags from description if present
        const description = data.description
          ? data.description.replace(/<[^>]*>/g, '').trim()
          : '';
        return {
          title: data.title || parsed.hostname,
          description: description || `Spotify — ${data.author_name || ''}`.trim(),
          image: data.thumbnail_url || null,
        };
      }
    } catch {
      // Fall through to OG scraping
    }
  }

  return null;
}

function extractOG(html, baseUrl) {
  const getMeta = (property) => {
    const patterns = [
      new RegExp(`<meta\\s+(?:property|name)=["']${property}["']\\s+content=(["'])(.*?)\\1`, 'si'),
      new RegExp(`<meta\\s+content=(["'])(.*?)\\1\\s+(?:property|name)=["']${property}["']`, 'si'),
    ];
    for (const regex of patterns) {
      const match = html.match(regex);
      if (match) return decodeEntities(match[2]);
    }
    return null;
  };

  let title = getMeta('og:title') || getMeta('twitter:title') || '';
  let description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
  let image = getMeta('og:image') || getMeta('twitter:image') || '';

  // Fallback: extract <title> tag
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = decodeEntities(titleMatch[1].trim());
  }

  if (!title) {
    try {
      title = new URL(baseUrl).hostname;
    } catch {
      title = 'Link';
    }
  }

  if (title.length > 200) title = title.slice(0, 200) + '…';
  if (description.length > 400) description = description.slice(0, 400) + '…';

  if (image && !image.startsWith('http://') && !image.startsWith('https://')) {
    try {
      image = new URL(image, baseUrl).href;
    } catch {
      image = null;
    }
  }

  return { title, description, image };
}

function getFallback(parsed, err) {
  if (err?.name === 'AbortError') {
    return {
      title: parsed.hostname,
      description: 'Could not load preview (timeout)',
      image: null,
    };
  }
  return {
    title: parsed.hostname,
    description: 'Could not load preview',
    image: null,
  };
}

function decodeEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}
