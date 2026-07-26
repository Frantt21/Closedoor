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
  const ogImage = image || 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor';
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

// ── CDN proxy routes ──
app.all('/cdn/*', cdnProxy);

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
    image: 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
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

  let ogData = {
    title: `@${username}`,
    description: `Check out @${username} on Closedoor!`,
    image: 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
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
          image: data.avatar_url || data.banner_url || 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
          url: `${req.protocol}://${req.get('host')}/profile/${data.username || username}`,
          username: data.username || username,
          type: 'profile',
        };
      }
    } catch (err) {
      console.warn('Error fetching profile for OG tags:', err.message);
    }
  }

  const html = injectOGTags(htmlTemplate, ogData);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ── Post route: fetch post data for rich OG tags ──
app.get('/post/:id', async (req, res) => {
  const { id } = req.params;

  let ogData = {
    title: 'Post | Closedoor',
    description: 'Check out this post on Closedoor.',
    image: 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
    url: `${req.protocol}://${req.get('host')}/post/${id}`,
    username: null,
    type: 'article',
  };

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
          image: data.image_url || 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
          url: `${req.protocol}://${req.get('host')}/post/${id}`,
          username: null,
          type: 'article',
        };
      }
    } catch (err) {
      console.warn('Error fetching post for OG tags:', err.message);
    }
  }

  const html = injectOGTags(htmlTemplate, ogData);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
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
