import { createClient } from '@supabase/supabase-js';

/**
 * Vite plugin (dev mode) that injects Open Graph meta tags into
 * /profile/:username pages so Discord/Twitter previews include
 * username, bio, and avatar/banner image.
 *
 * Note: Discord cannot reach localhost. To test:
 *   1. Run `npm run dev`
 *   2. Use ngrok: `npx ngrok http 5173`
 *   3. Share the ngrok URL in Discord
 */
export default function ogTagsPlugin() {
  let supabase = null;
  const cache = new Map();

  return {
    name: 'og-tags',
    configureServer(server) {
      // Lazy-init Supabase client from env vars (Vite loads .env automatically)
      const url = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_DATA_API_URL || '';
      const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
      if (url && key) {
        supabase = createClient(url, key);
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler: async (html, ctx) => {
        const match = ctx.path?.match(/^\/profile\/([a-zA-Z0-9_]+)/);
        if (!match) return html;

        const username = match[1];

        // Build fallback OG data (always available)
        const getFallback = () => ({
          title: `@${username}`,
          description: `Check out @${username} on Closedoor!`,
          image: 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg',
        });

        let og = cache.get(username);

        // Fetch from Supabase if not cached
        if (!og && supabase) {
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
                image: data.banner_url || data.avatar_url || 'https://i.pinimg.com/736x/ac/13/74/ac137456b996efec340292a585eb6dc7.jpg',
              };
              cache.set(username, og);
            }
          } catch (err) {
            console.warn('[og-tags] Error fetching profile:', err.message);
          }
        }

        og = og || getFallback();

        const meta = `
    <meta property="og:title" content="${esc(og.title)}" />
    <meta property="og:description" content="${esc(og.description)}" />
    <meta property="og:image" content="${esc(og.image)}" />
    <meta property="og:url" content="${esc(ctx.path)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="Closedoor" />
    <meta name="description" content="${esc(og.description)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(og.title)}" />
    <meta name="twitter:description" content="${esc(og.description)}" />
    <meta name="twitter:image" content="${esc(og.image)}" />`;

        return html.replace('</title>', `</title>${meta}`);
      },
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
