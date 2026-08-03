import dotenv from 'dotenv';

// ── Load env files like Vite does: .env → .env.local → .env.development → .env.development.local ──
const cwd = process.cwd();
const envFiles = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
];
for (const file of envFiles) {
  dotenv.config({ path: resolve(cwd, file), override: false });
}

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { buildSitemapUrls, wrapSitemapXml } from './api/_sitemap.js';
import { issueLiveKitToken } from './api/_livekit.js';
import { searchMusicServer, resolveTrackPreview } from './api/_music.js';
import { combinedMusicSearch, handleStreamRequest, getMusicHealth } from './api/_musicStream.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const INDEX_HTML = join(DIST, 'index.html');

// ── Read env vars (same as Vite uses) ──
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_DATA_API_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// ── Normalize Supabase URL ──
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch { return url; }
}

const supabaseUrl = normalizeUrl(SUPABASE_URL);
const supabaseKey = SUPABASE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ── In-memory cache with TTL for OG data ──
const ogCache = new Map();
const OG_CACHE_TTL = {
  profile: 5 * 60 * 1000,   // 5 min for profiles
  post: 5 * 60 * 1000,       // 5 min for posts
  link: 60 * 60 * 1000,      // 1 hour for external link metadata
};
function cacheGet(key) {
  const entry = ogCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { ogCache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttl) {
  ogCache.set(key, { data, expiry: Date.now() + ttl });
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── Check if build exists ──
if (!existsSync(DIST)) {
  console.error(`❌ Build not found at ${DIST}. Run "npm run build" first.`);
  process.exit(1);
}

// ── Read index.html template ──
const htmlTemplate = readFileSync(INDEX_HTML, 'utf-8');

// ── Inject OG tags into HTML ──
function injectOGTags(html, { title, description, image, url, username, type = 'website' } = {}) {
  const siteName = 'Closedoor';
  const fullTitle = title ? `${title} | ${siteName}` : siteName;
  const ogTitle = title || siteName;
  const ogDesc = description || 'Join the community and share your thoughts on Closedoor.';
  const ogImage = image || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor';
  const ogUrl = url || 'https://closedoor.app';

  let result = html;
  // Update <title> (accept attributes on the tag, use dotAll flag for cross-line content)
  result = result.replace(/<title[^>]*>.*?<\/title>/s, `<title>${fullTitle}</title>`);

  // Inject OG meta tags after <title> or </title>
  const metaTags = `
    <meta property="og:title" content="${escapeHtml(ogTitle)}" />
    <meta property="og:description" content="${escapeHtml(ogDesc)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:url" content="${escapeHtml(ogUrl)}" />
    <meta property="og:type" content="${escapeHtml(type)}" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta name="description" content="${escapeHtml(ogDesc)}" />
    ${username ? `<meta property="profile:username" content="${escapeHtml(username)}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(ogDesc)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />`;

  // Insert after the existing <title> tag
  result = result.replace('</title>', `</title>${metaTags}`);
  return result;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── CDN proxy config ──
const CDN_TARGET = process.env.CDN_TARGET || 'http://api.foranly.space:24587';

// ── Forward CDN requests to the Go CDN server (fixes Mixed Content on HTTPS) ──
const cdnProxy = (req, res) => {
  const cdnPath = req.originalUrl.replace(/^\/cdn/, '/cdn');
  const options = new URL(CDN_TARGET + cdnPath);

  const proxyReq = http.request(
    {
      hostname: options.hostname,
      port: options.port,
      path: options.pathname + options.search,
      method: req.method,
      headers: {
        ...req.headers,
        'X-Forwarded-Host': req.get('host'),
        'X-Forwarded-Proto': req.protocol,
        // Remove host header so the CDN server uses the forwarded one
        host: options.host,
      },
      timeout: 30000,
    },
    (proxyRes) => {
      // Forward headers from CDN server
      const forwardHeaders = ['content-type', 'content-length', 'cache-control', 'x-content-type-options'];
      forwardHeaders.forEach((h) => {
        if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
      });
      res.status(proxyRes.statusCode);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.warn('CDN proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: 'CDN proxy error: ' + err.message });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ success: false, error: 'CDN timeout' });
  });

  // Forward request body (for POST uploads)
  req.pipe(proxyReq);
};

// ── Sitemap route — must be BEFORE express.static to take priority ──
app.get('/sitemap.xml', async (req, res) => {
  const SITE_URL = `${req.protocol}://${req.get('host')}`;

  if (!supabase) {
    // Fallback: serve the static sitemap.xml from public/
    const staticSitemap = join(DIST, 'sitemap.xml');
    if (existsSync(staticSitemap)) {
      return res.sendFile(staticSitemap);
    }
    // Minimal inline sitemap
    const fallbackUrls = [
      `  <url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      `  <url><loc>${SITE_URL}/Explore</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
      `  <url><loc>${SITE_URL}/Trending</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`,
    ];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(wrapSitemapXml(fallbackUrls));
  }

  const urls = await buildSitemapUrls(supabase, SITE_URL);
  const xml = wrapSitemapXml(urls);

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  res.status(200).end(xml);
});

// ── Serve static files with intelligent caching ──
// Files with content hashes in their name (e.g., vendor-react-X4ZWUDZZ.js)
// are immutable — the hash changes only when content changes.
// index.html is served here for the root path / (before the catch-all),
// so we explicitly set no-cache to ensure fresh content on each visit.
const YEAR_IN_SECONDS = 31536000;

function isImmutable(filePath) {
  // Match Vite's hashed filenames: name-HASH.ext where HASH is 8+ alphanumeric chars
  return /-[A-Za-z0-9_-]{6,}\.[a-z]+$/.test(filePath);
}

app.use(
  express.static(DIST, {
    setHeaders(res, filePath) {
      if (isImmutable(filePath)) {
        // Content-hashed files = cache forever (filename changes on content change)
        res.setHeader(
          'Cache-Control',
          `public, max-age=${YEAR_IN_SECONDS}, immutable`
        );
      } else if (filePath.endsWith('index.html')) {
        // index.html must always be fresh — ETag handles conditional revalidation
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        // Other static assets (logo.svg, robots.txt, etc.) — cache 1 day
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

// ── OG Link preview endpoint (local dev) ──
// Matches the Vercel serverless function at /api/og-link.js
app.get('/api/og-link', async (req, res) => {
  // ── Check cache ──
  const cacheKey = `link_${req.query?.url}`;
  if (req.query?.url) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, ...cached, url: req.query.url });
    }
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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ success: false, error: 'Only http/https URLs are allowed' });
    return;
  }

  // ── Try known oEmbed providers first ──
  const oembedResult = await tryOembed(targetUrl, parsed);
  if (oembedResult) {
    cacheSet(cacheKey, oembedResult, OG_CACHE_TTL.link);
    return res.status(200).json({
      success: true,
      ...oembedResult,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  }

  // ── Fallback: scrape OG tags ──
  try {
    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
      },
    });
    const html = await response.text();
    const og = extractOG(html, targetUrl);
    cacheSet(cacheKey, og, OG_CACHE_TTL.link);
    return res.json({
      success: true,
      ...og,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  } catch (err) {
    console.warn('OG link fetch error:', err.message);
    const fallback = getFallback(parsed, err);
    return res.json({
      success: true,
      ...fallback,
      url: targetUrl,
      favicon: `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
    });
  }
});

// ── Helper: try oEmbed for known providers (Spotify, etc.) ──
async function tryOembed(targetUrl, parsed) {
  const hostname = parsed.hostname.toLowerCase();

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

// ── Helper: extract OG tags from HTML ──
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

  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) title = decodeEntities(titleMatch[1].trim());
  }

  if (!title) {
    try { title = new URL(baseUrl).hostname; } catch { title = 'Link'; }
  }

  if (title.length > 200) title = title.slice(0, 200) + '…';
  if (description.length > 400) description = description.slice(0, 400) + '…';

  if (image && !image.startsWith('http://') && !image.startsWith('https://')) {
    try { image = new URL(image, baseUrl).href; } catch { image = null; }
  }

  return { title, description, image };
}

function getFallback(parsed, err) {
  if (err?.name === 'AbortError') {
    return { title: parsed.hostname, description: 'Could not load preview (timeout)', image: null };
  }
  return { title: parsed.hostname, description: 'Could not load preview', image: null };
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

// ── CDN proxy routes ──
// Express 5 (path-to-regexp v8) ya no acepta '*' como wildcard → {*path}
app.all('/cdn/{*path}', cdnProxy);

// ── LiveKit token endpoint (local dev) — usa la lógica compartida api/_livekit.js ──
// Emite un AccessToken de LiveKit verificando que el usuario sea participante
// de la conversación de la llamada. En producción lo maneja Vercel.
app.post('/api/livekit-token', express.json(), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const result = await issueLiveKitToken({
    supabaseUrl,
    supabaseKey,
    livekitUrl: process.env.LIVEKIT_URL || '',
    livekitApiKey: process.env.LIVEKIT_API_KEY || '',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET || '',
    accessToken,
    room: req.body?.room,
  });

  if (result.ok) {
    res.status(200).json({ success: true, token: result.token, url: result.url });
  } else {
    res.status(result.status).json({ success: false, error: result.error });
  }
});

// ── Music search proxy (local dev) — matches api/music-search.js ──
// Deezer no envía headers CORS, así que la búsqueda se hace por el servidor;
// iTunes se consulta directo desde el navegador (CORS OK).
app.get('/api/music-search', async (req, res) => {
  const provider = req.query?.provider === 'itunes' ? 'itunes' : 'deezer';

  // ── Modo track: resolver preview FRESCO (los de Deezer expiran) ──
  // Uso: GET /api/music-search?track=<id>&provider=deezer (no requiere ?q)
  const trackId = req.query?.track;
  if (trackId) {
    try {
      const previewUrl = await resolveTrackPreview(trackId, provider);
      res.status(200).json({ success: true, provider, previewUrl });
    } catch (err) {
      console.warn('Music search proxy error:', err.message);
      res.status(502).json({ success: false, error: err.message });
    }
    return;
  }

  const q = (req.query?.q || '').trim();
  if (!q) {
    res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    return;
  }

  try {
    const results = await searchMusicServer(q, provider, req.query?.limit);
    res.status(200).json({ success: true, provider, results });
  } catch (err) {
    console.warn('Music search proxy error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Música: stream completo vía yt-dlp + ffmpeg ──
// ⚠️ Solo server self-hosted (Vercel serverless no puede correr yt-dlp).
// Requiere yt-dlp y ffmpeg instalados; configurables con YTDLP_BIN/FFMPEG_BIN.
//
// CORS para /api/music: el server puede exponerse vía túnel (Termux + ngrok/
// cloudflared) y el app desplegado lo consume cross-origin. El API no usa
// cookies → `*` es seguro. OPTIONS responde al preflight que genera el header
// custom `ngrok-skip-browser-warning` en las peticiones fetch.
app.use('/api/music', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, ngrok-skip-browser-warning');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/api/music/health', async (req, res) => {
  res.status(200).json(await getMusicHealth());
});

app.get('/api/music/search', async (req, res) => {
  // ── Modo track: preview FRESCO de Deezer (expira ≈ 15 min) — paridad con
  //    music-server.js (Termux) y api/music-search.js (Vercel serverless)
  const trackId = req.query?.track;
  if (trackId) {
    try {
      const previewUrl = await resolveTrackPreview(trackId, 'deezer');
      res.status(200).json({ success: true, provider: 'deezer', previewUrl });
    } catch (err) {
      console.warn('Music preview resolve error:', err.message);
      res.status(502).json({ success: false, error: err.message });
    }
    return;
  }

  const q = (req.query?.q || '').trim();
  if (!q) {
    res.status(400).json({ success: false, error: 'Missing ?q parameter' });
    return;
  }
  try {
    const data = await combinedMusicSearch(q, req.query?.limit);
    res.status(200).json(data);
  } catch (err) {
    console.warn('Music combined search error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Rate limit simple por IP para el stream (resolver yt-dlp es caro y
//    un abuso podría hacer que YouTube bloquee la IP del server) ──
const streamLimits = new Map(); // ip → { count, resetAt }
function rateLimitStream(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = streamLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    streamLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  if (streamLimits.size > 5000) streamLimits.clear();
  return entry.count <= 15; // máx 15 streams/min por IP
}

app.get('/api/music/stream', async (req, res) => {
  const { artist = '', title = '', duration = 0, fresh } = req.query || {};
  if (!title) {
    res.status(400).json({ success: false, error: 'Missing ?title parameter' });
    return;
  }
  if (!rateLimitStream(req)) {
    res.status(429).json({ success: false, error: 'Too many stream requests, try again in a minute' });
    return;
  }
  await handleStreamRequest(req, res, { artist, title, duration, fresh: fresh === '1' });
});

// ── Route-based OG tag configuration ──
function getOGForRoute(req) {
  const host = req.get('host');
  const protocol = req.protocol;
  const baseUrl = `${protocol}://${host}`;
  const path = req.path;
  const fullUrl = `${baseUrl}${path}`;

  // Default: Home
  let og = {
    title: 'Closedoor',
    description: 'Join the community, share your thoughts, and discover new people on Closedoor.',
    image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
    url: fullUrl,
    type: 'website',
    username: null,
  };

  if (path.startsWith('/profile/')) {
    og.title = `${path.replace('/profile/', '@')}`;
    og.description = `Check out ${path.replace('/profile/', '@')} on Closedoor!`;
    og.type = 'profile';
    og.username = path.replace('/profile/', '');
  } else if (path === '/Explore' || path.startsWith('/Explore')) {
    og.title = 'Explore | Closedoor';
    og.description = 'Discover new people and profiles on Closedoor.';
  } else if (path === '/Trending' || path.startsWith('/Trending')) {
    og.title = 'Trending | Closedoor';
    og.description = 'See what\'s trending on Closedoor — hashtags, topics, and more.';
  } else if (path === '/Comunidades' || path.startsWith('/Comunidades')) {
    og.title = 'Comunidades | Closedoor';
    og.description = 'Join communities and connect with people who share your interests on Closedoor.';
  } else if (path.startsWith('/Hashtag/')) {
    const tag = path.replace('/Hashtag/', '');
    og.title = `#${tag} | Closedoor`;
    og.description = `Explore posts tagged with #${tag} on Closedoor.`;
  }

  return og;
}

// ── Profile route: fetch user data and inject rich OG tags ──
app.get('/profile/:username', async (req, res) => {
  const { username } = req.params;

  // ── Check cache ──
  const cacheKey = `profile_${username.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendOGPage(req, res, cached);
  }

  let ogData = {
    title: `@${username}`,
    description: `Check out @${username} on Closedoor!`,
    image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
    url: `${req.protocol}://${req.get('host')}/profile/${username}`,
    username,
    type: 'profile',
  };

  // Try to fetch from Supabase for richer OG tags
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, bio, avatar_url, banner_url')
        .eq('username', username.toLowerCase())
        .maybeSingle();

      if (data && !error) {
        ogData = {
          title: `@${data.username || username}`,
          description: data.bio
            ? (data.bio.length > 200 ? data.bio.slice(0, 200) + '...' : data.bio)
            : `Check out @${data.username || username} on Closedoor!`,
          image: data.avatar_url || data.banner_url || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
          url: `${req.protocol}://${req.get('host')}/profile/${data.username || username}`,
          username: data.username || username,
          type: 'profile',
        };
        cacheSet(cacheKey, ogData, OG_CACHE_TTL.profile);
      }
    } catch (err) {
      console.warn('Error fetching profile for OG tags:', err.message);
    }
  }

  sendOGPage(req, res, ogData);
});

function sendOGPage(req, res, ogData) {
  const host = req.get('host');
  const protocol = req.protocol;
  ogData.url = `${protocol}://${host}${req.path}`;
  const html = injectOGTags(htmlTemplate, ogData);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ── Post route: fetch post data for rich OG tags ──
app.get('/post/:id', async (req, res) => {
  const { id } = req.params;

  let ogData = {
    title: 'Post | Closedoor',
    description: 'Check out this post on Closedoor.',
    image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
    url: `${req.protocol}://${req.get('host')}/post/${id}`,
    username: null,
    type: 'article',
  };

  // ── Check cache ──
  const cacheKey = `post_${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendOGPage(req, res, cached);
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('content, image_url, profiles!posts_user_id_fkey (username)')
        .eq('id', id)
        .maybeSingle();

      if (data && !error) {
        const cleanContent = data.content
          ? data.content.replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '').trim()
          : '';
        ogData = {
          title: data.profiles?.username
            ? `Post by @${data.profiles.username} | Closedoor`
            : 'Post | Closedoor',
          description: cleanContent
            ? (cleanContent.length > 200 ? cleanContent.slice(0, 200) + '...' : cleanContent)
            : 'Check out this post on Closedoor.',
          image: data.image_url || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
          url: `${req.protocol}://${req.get('host')}/post/${id}`,
          username: null,
          type: 'article',
        };
        cacheSet(cacheKey, ogData, OG_CACHE_TTL.post);
      }
    } catch (err) {
      console.warn('Error fetching post for OG tags:', err.message);
    }
  }

  sendOGPage(req, res, ogData);
});

// ── All other routes: serve index.html with route-specific OG tags ──
app.get('/{*path}', (req, res) => {
  const og = getOGForRoute(req);
  const html = injectOGTags(htmlTemplate, og);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`🚀 FastChange server running at http://localhost:${PORT}`);
  console.log(`   OG tags active for /profile/:username routes`);
  if (!supabase) {
    console.warn('   ⚠️  Supabase credentials not found in environment. OG data will be minimal.');
    console.warn('   Tried env files: ' + envFiles.join(', '));
    console.warn('   Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in one of these files or system env.');
  }
});
