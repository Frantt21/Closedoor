/**
 * Vercel serverless function that injects Open Graph meta tags
 * into /profile/:username pages for crawlers (Discord, Twitter, etc.).
 *
 * Vercel runs this for routes matching /profile/:username
 * before serving the SPA fallback.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const FALLBACK_IMAGE = 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor';

// ── In-memory cache with TTL ──
const profileOgCache = new Map();
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
function cacheGet(key) {
  const entry = profileOgCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { profileOgCache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  profileOgCache.set(key, { data, expiry: Date.now() + PROFILE_CACHE_TTL });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end('Method not allowed');
    return;
  }

  const match = req.url?.match(/^\/profile\/([a-zA-Z0-9_]+)/);
  if (!match) {
    res.status(404).end('Not found');
    return;
  }

  const username = match[1];

  // ── Check cache ──
  const cacheKey = `profile_${username.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return sendOG(req, res, username, cached);
  }

  // ── Fetch profile data from Supabase ──
  let og = {
    title: `@${username}`,
    description: `Check out @${username} on Closedoor!`,
    image: FALLBACK_IMAGE,
  };

  if (supabase) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('username, bio, avatar_url, banner_url')
        .eq('username', username.toLowerCase())
        .maybeSingle();

      if (data) {
        og = {
          title: `@${data.username || username}`,
          description: data.bio
            ? (data.bio.length > 200 ? data.bio.slice(0, 200) + '...' : data.bio)
            : `Check out @${data.username || username} on Closedoor!`,
          image: data.avatar_url || data.banner_url || FALLBACK_IMAGE,
        };
        cacheSet(cacheKey, og);
      }
    } catch (err) {
      console.warn('[og-profile] Fetch error:', err.message);
    }
  }

  sendOG(req, res, username, og);
}

function sendOG(req, res, username, og) {
  try {
    const htmlPath = join(process.cwd(), 'dist', 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');

    const metaTags = `
    <meta property="og:title" content="${esc(og.title)}" />
    <meta property="og:description" content="${esc(og.description)}" />
    <meta property="og:image" content="${esc(og.image)}" />
    <meta property="og:url" content="https://${req.headers.host || 'fastchange.vercel.app'}/profile/${username}" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="${esc('Closedoor')}" />
    <meta name="description" content="${esc(og.description)}" />
    <meta property="profile:username" content="${esc(username)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(og.title)}" />
    <meta name="twitter:description" content="${esc(og.description)}" />
    <meta name="twitter:image" content="${esc(og.image)}" />`;

    const modifiedHtml = html.replace('</title>', `</title>${metaTags}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).end(modifiedHtml);
  } catch (err) {
    console.error('[og-profile] Error reading index.html:', err.message);
    res.status(500).end('Internal error');
  }
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
