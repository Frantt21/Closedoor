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

const FALLBACK_IMAGE = 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg';

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
          image: data.banner_url || data.avatar_url || FALLBACK_IMAGE,
        };
      }
    } catch (err) {
      console.warn('[og-profile] Fetch error:', err.message);
    }
  }

  // ── Read the built index.html and inject OG tags ──
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
