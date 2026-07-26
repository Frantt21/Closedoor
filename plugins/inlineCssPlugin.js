/**
 * Vite plugin that inlines CSS files into the HTML as <style> tags.
 *
 * This eliminates render-blocking CSS requests (the browser doesn't
 * need to fetch CSS files — they're already in the HTML).
 *
 * Only affects production builds (dev uses Vite's native CSS injection).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

export default function inlineCssPlugin() {
  return {
    name: 'inline-css',

    closeBundle() {
      const distDir = resolve('dist');
      const htmlPath = join(distDir, 'index.html');
      if (!existsSync(htmlPath)) return;

      let html = readFileSync(htmlPath, 'utf-8');

      // Find all <link rel="stylesheet"> tags
      const linkRegex = /<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*\/?>/gi;
      const matches = [];
      let match;

      while ((match = linkRegex.exec(html)) !== null) {
        matches.push({ fullTag: match[0], href: match[1] });
      }

      if (matches.length === 0) {
        console.log('[inline-css] No CSS link tags found — nothing to inline');
        return;
      }

      // Process each match, replacing link tags with inline styles
      for (const { fullTag, href } of matches) {
        const cssPath = join(distDir, href);
        if (!existsSync(cssPath)) {
          console.warn(`[inline-css] File not found: ${cssPath}`);
          continue;
        }

        const cssContent = readFileSync(cssPath, 'utf-8');
        const styleTag = `<style>${cssContent}</style>`;

        html = html.replace(fullTag, styleTag);
        console.log(
          `[inline-css] Inlined: ${href} (${(cssContent.length / 1024).toFixed(1)} KiB)`
        );
      }

      writeFileSync(htmlPath, html, 'utf-8');
      console.log('[inline-css] All CSS inlined — render-blocking styles eliminated');
    },
  };
}
