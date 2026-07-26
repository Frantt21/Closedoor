/**
 * Shared sitemap utility.
 * Generates an array of XML <url> entries for the sitemap.
 *
 * Used by:
 *   - api/sitemap.xml.js (Vercel serverless function)
 *   - server.js (Express dev/prod mode)
 *
 * @param {object}  supabase  Supabase client instance (or null)
 * @param {string}  siteUrl   Base URL of the site (e.g. https://app.foranly.space)
 * @returns {Promise<string[]>} Array of formatted XML <url> blocks
 */
export async function buildSitemapUrls(supabase, siteUrl) {
  const urls = [];

  // ── Static routes ──
  const staticRoutes = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/Explore', priority: '0.8', changefreq: 'daily' },
    { loc: '/Trending', priority: '0.7', changefreq: 'daily' },
  ];
  for (const r of staticRoutes) {
    urls.push(`  <url>
    <loc>${siteUrl}${r.loc}</loc>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`);
  }

  if (!supabase) return urls;

  // ── Dynamic: public profiles ──
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('username, updated_at')
      .or('is_private.is.null,is_private.eq.false')
      .not('username', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1000);

    if (profiles) {
      for (const p of profiles) {
        const lastmod = p.updated_at
          ? new Date(p.updated_at).toISOString().split('T')[0]
          : '';
        urls.push(`  <url>
    <loc>${siteUrl}/profile/${encodeURIComponent(p.username)}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
      }
    }
  } catch (err) {
    console.warn('[sitemap] Error fetching profiles:', err.message);
  }

  // ── Dynamic: recent public posts ──
  try {
    const { data: posts } = await supabase
      .from('posts')
      .select('id, created_at, profiles!posts_user_id_fkey (is_private)')
      .neq('is_encrypted', true)
      .or('scheduled_at.is.null,scheduled_at.lte.now')
      .order('created_at', { ascending: false })
      .limit(500);

    if (posts) {
      const publicPosts = posts.filter((p) => !p.profiles?.is_private);
      for (const p of publicPosts) {
        const lastmod = p.created_at
          ? new Date(p.created_at).toISOString().split('T')[0]
          : '';
        urls.push(`  <url>
    <loc>${siteUrl}/post/${p.id}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`);
      }
    }
  } catch (err) {
    console.warn('[sitemap] Error fetching posts:', err.message);
  }

  return urls;
}

/**
 * Wraps URL entries into a full sitemap XML document.
 * @param {string[]} urls - Array of <url> blocks from buildSitemapUrls
 * @returns {string} Complete sitemap XML
 */
export function wrapSitemapXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}
