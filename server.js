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
function injectOGTags(html, { title, description, image, url, username }) {
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
    <meta property="og:type" content="profile" />
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

// ── Serve static files from dist ──
app.use(express.static(DIST));

// ── Profile route: fetch user data and inject OG tags ──
app.get('/profile/:username', async (req, res) => {
  const { username } = req.params;

  // Default OG tags
  let ogData = {
    title: `@${username}`,
    description: `Check out @${username} on Closedoor!`,
    image: 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
    url: `${req.protocol}://${req.get('host')}/profile/${username}`,
    username,
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

// ── All other routes: serve default index.html ──
app.get('/{*path}', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(htmlTemplate);
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
