import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite plugin that injects Open Graph meta tags for crawlers.
 *
 * For bot/crawler requests (Discord, Twitter, Facebook, etc.):
 *   - Reads index.html directly from disk
 *   - Injects OG/twitter meta tags with route-specific data
 *   - Sends the modified HTML (crawlers don't execute JS anyway)
 *
 * Supported routes:
 *   /profile/:username  — fetches profile from Supabase for rich OG
 *   /Post/:id           — fetches post content from Supabase for rich OG
 *   /Explore, /Trending, /Comunidades, /Hashtag/:tag, /download — static OG per route
 *   / (Home) and others — default OG tags
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

  function getOGForPath(path) {
    let title = 'Closedoor';
    let description = 'Join the community, share your thoughts, and discover new people on Closedoor.';
    let image = 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor';
    let type = 'website';
    let username = null;

    if (path.startsWith('/Explore')) {
      title = 'Explore | Closedoor';
      description = 'Discover new people and profiles on Closedoor.';
    } else if (path.startsWith('/Trending')) {
      title = 'Trending | Closedoor';
      description = "See what's trending on Closedoor.";
    } else if (/^\/download/i.test(path)) {
      // Página de descargas de la app de escritorio: se comparte fuera de la app
      // (es el destino del aviso del reproductor), así que merece OG propio.
      title = 'Foranly for desktop | Closedoor';
      description = 'Get the desktop app: profile songs play in full, resolved from your own connection.';
    } else if (path.startsWith('/Comunidades')) {
      title = 'Comunidades | Closedoor';
      description = 'Join communities and connect with people who share your interests on Closedoor.';
    } else if (path.startsWith('/c/')) {
      title = 'Community | Closedoor';
      description = 'Check out this community on Closedoor.';
    } else if (path.startsWith('/Hashtag/')) {
      const tag = path.replace('/Hashtag/', '');
      title = `#${tag} | Closedoor`;
      description = `Explore posts tagged with #${tag} on Closedoor.`;
    } else if (path.startsWith('/Post/')) {
      title = 'Post | Closedoor';
      description = 'Check out this post on Closedoor.';
      type = 'article';
    }

    return { title, description, image, type, username };
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

      // ── Middleware: intercept public routes for crawlers ──
      server.middlewares.use(async (req, res, next) => {
        const hasOgParam = req.url?.includes('?og') || req.url?.includes('&og');
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        const isCrawler = /discord|twitterbot|facebookexternalhit|slack|telegram|whatsapp|bot\//.test(ua);
        if (!isCrawler && !hasOgParam) {
          next();
          return;
        }

        const path = (req.url || '').split('?')[0];
        const profileMatch = path.match(/^\/profile\/([a-zA-Z0-9_]+)/);
        const postMatch = path.match(/^\/Post\/([a-zA-Z0-9-]+)/);
        const communityMatch = path.match(/^\/c\/([a-zA-Z0-9-]+)/);
        const username = profileMatch ? profileMatch[1] : null;

        // ── Resolve OG data ──
        let og;

        if (communityMatch) {
          // Community route — fetch community from Supabase with cache
          const slug = communityMatch[1];
          og = cache.get('community_' + slug);
          if (!og) {
            og = {
              title: `c/${slug} | Closedoor`,
              description: `Join the c/${slug} community on Closedoor!`,
              image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
              type: 'website',
              username: null,
            };

            if (supabase) {
              try {
                const { data } = await supabase
                  .from('communities')
                  .select('name, slug, description, avatar_url, banner_url, member_count')
                  .eq('slug', slug)
                  .maybeSingle();

                if (data) {
                  og = {
                    title: `c/${data.slug} · ${data.name} | Closedoor`,
                    description: data.description
                      ? (data.description.length > 200 ? data.description.slice(0, 200) + '...' : data.description)
                      : `Join c/${data.slug} on Closedoor — ${data.member_count || 0} members.`,
                    image: data.banner_url || data.avatar_url || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
                    type: 'website',
                    username: null,
                  };
                  cache.set('community_' + slug, og);
                }
              } catch (err) {
                console.warn('[og-tags] Community fetch error:', err.message);
              }
            }
          }
        } else if (username) {
          // Profile route — fetch from Supabase with cache
          og = cache.get('profile_' + username);
          if (!og) {
            og = {
              title: `@${username}`,
              description: `Check out @${username} on Closedoor!`,
              image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
              type: 'profile',
              username,
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
                    image: data.avatar_url || data.banner_url || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
                    type: 'profile',
                    username: data.username || username,
                  };
                  cache.set('profile_' + username, og);
                }
              } catch (err) {
                console.warn('[og-tags] Profile fetch error:', err.message);
              }
            }
          }
        } else if (postMatch) {
          // Post route — fetch from Supabase
          const postId = postMatch[1];
          og = cache.get('post_' + postId);
          if (!og) {
            og = {
              title: 'Post | Closedoor',
              description: 'Check out this post on Closedoor.',
              image: 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
              type: 'article',
              username: null,
            };

            if (supabase) {
              try {
                const { data } = await supabase
                  .from('posts')
                  .select('content, image_url, profiles!posts_user_id_fkey (username)')
                  .eq('id', postId)
                  .maybeSingle();

                if (data) {
                  const cleanContent = data.content
                    ? data.content.replace(/<[^>]*>/g, '').replace(/https?:\/\/\S+/g, '').trim()
                    : '';
                  og = {
                    title: data.profiles?.username
                      ? `Post by @${data.profiles.username} | Closedoor`
                      : 'Post | Closedoor',
                    description: cleanContent
                      ? (cleanContent.length > 200 ? cleanContent.slice(0, 200) + '...' : cleanContent)
                      : 'Check out this post on Closedoor.',
                    image: data.image_url || 'https://placehold.co/1200x630/1a1a2e/6b7280?text=Closedoor',
                    type: 'article',
                    username: null,
                  };
                  cache.set('post_' + postId, og);
                }
              } catch (err) {
                console.warn('[og-tags] Post fetch error:', err.message);
              }
            }
          }
        } else {
          // Static routes — use config map
          og = getOGForPath(path);
        }

        // ── Build modified HTML with OG tags ──
        const html = loadIndexHtml(server.config.root);
        if (!html) {
          next();
          return;
        }

        const siteName = 'Closedoor';
        const ogUrl = `https://${req.headers.host || 'localhost:5173'}${path}`;
        const metaTags = `
    <meta property="og:title" content="${esc(og.title)}" />
    <meta property="og:description" content="${esc(og.description)}" />
    <meta property="og:image" content="${esc(og.image)}" />
    <meta property="og:url" content="${esc(ogUrl)}" />
    <meta property="og:type" content="${esc(og.type || 'website')}" />
    <meta property="og:site_name" content="${esc(siteName)}" />
    <meta name="description" content="${esc(og.description)}" />
    ${og.username ? `<meta property="profile:username" content="${esc(og.username)}" />` : ''}
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
