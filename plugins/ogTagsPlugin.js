import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite plugin that injects Open Graph meta tags into /profile/:username pages.
 *
 * For bot/crawler requests (Discord, Twitter, Facebook, etc.):
 *   - Reads index.html directly from disk
 *   - Injects OG/twitter meta tags with profile data from Supabase
 *   - Sends the modified HTML (crawlers don't execute JS anyway)
 *
 * For real browser requests:
 *   - Passes through to Vite's normal middleware chain
 *   - The React SPA loads normally with HMR
 */
export default function ogTagsPlugin() {
  let supabase = null;
  const cache = new Map();
  let indexHtml = '';
  let htmlLoaded = false;

  function loadIndexHtml(root) {
    if (!htmlLoaded) {
      try {
        indexHtml = readFileSync(resolve(root, 'index.html'), 'utf-8');
        htmlLoaded = true;
      } catch (e) {
        console.warn('[og-tags] Could not read index.html:', e.message);
      }
    }
    return indexHtml;
  }

  return {
    name: 'og-tags',

    configResolved(config) {
      loadIndexHtml(config.root);
    },

    configureServer(server) {
      // Lazy-init Supabase client from env vars
      const url = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_DATA_API_URL || '';
      const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
      if (url && key) {
        supabase = createClient(url, key);
      }

      // ── Middleware: intercept /profile/:username for crawlers only ──
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/profile\/([a-zA-Z0-9_]+)/);
        if (!match) {
          next();
          return;
        }

        // Check if OG tags are forced via query param (?og) or request is from a known crawler
        const hasOgParam = req.url?.includes('?og') || req.url?.includes('&og');
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        const isCrawler = /discord|twitterbot|facebookexternalhit|slack|telegram|whatsapp|bot\//.test(ua);
        if (!isCrawler && !hasOgParam) {
          next();
          return;
        }

        const username = match[1];

        // ── Fetch or get cached OG data ──
        let og = cache.get(username);
        if (!og) {
          og = {
            title: `@${username}`,
            description: `Check out @${username} on Closedoor!`,
            image: 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
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
                  image: data.avatar_url || data.banner_url || 'https://placehold.co/1200x630/1a1a2e/e94560?text=Closedoor',
                };
                cache.set(username, og);
              }
            } catch (err) {
              console.warn('[og-tags] Profile fetch error:', err.message);
            }
          }
        }

        // ── Build modified HTML with OG tags ──
        const html = loadIndexHtml(server.config.root);
        if (!html) {
          next();
          return;
        }

        const siteName = 'Closedoor';
        const metaTags = `
    <meta property="og:title" content="${esc(og.title)}" />
    <meta property="og:description" content="${esc(og.description)}" />
    <meta property="og:image" content="${esc(og.image)}" />
    <meta property="og:url" content="${esc(req.url)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="${esc(siteName)}" />
    <meta name="description" content="${esc(og.description)}" />
    <meta property="profile:username" content="${esc(username)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(og.title)}" />
    <meta name="twitter:description" content="${esc(og.description)}" />
    <meta name="twitter:image" content="${esc(og.image)}" />`;

        const modifiedHtml = html.replace('</title>', `</title>${metaTags}`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(modifiedHtml);
      });
    },
  };
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
