/**
 * Vite plugin that injects <link rel="modulepreload"> for critical
 * route chunks (Home, Profile) so the browser starts downloading
 * them in parallel while parsing the HTML, before the main JS loads.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export default function preloadRouteChunks() {
  // Module-name patterns to match our critical routes.
  // Use forward slashes — we normalize module IDs before matching.
  const ROUTE_PATTERNS = ['Pages/Home.jsx', 'Pages/profile.jsx'];
  let criticalFiles = [];

  return {
    name: 'preload-route-chunks',

    generateBundle(_, bundle) {
      if (!bundle || typeof bundle !== 'object') return;

      const found = [];

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk' || !fileName.endsWith('.js')) continue;

        const moduleIds = Object.keys(chunk.modules || {});
        const isCritical = moduleIds.some((id) => {
          // Normalize path separators (Windows uses backslashes)
          const normalized = id.replace(/\\/g, '/');
          return ROUTE_PATTERNS.some((pattern) =>
            normalized.includes(pattern)
          );
        });

        if (isCritical) {
          // fileName includes the directory prefix (e.g. "assets/Home-BhZG_8cU.js")
          // Strip it so we can use a clean /assets/{basename} URL
          found.push(fileName);
        }
      }

      criticalFiles = found;
    },

    closeBundle() {
      if (criticalFiles.length === 0) return;

      const htmlPath = resolve('dist', 'index.html');
      if (!existsSync(htmlPath)) return;

      let html = readFileSync(htmlPath, 'utf-8');

      // Build modulepreload links for JS chunks
      // Vite stores chunk filenames as "assets/name-hash.js" — strip the directory
      // so our href becomes "/assets/name-hash.js" not "/assets/assets/name-hash.js"
      const preloadLinks = criticalFiles
        .map((f) => {
          const basename = f.split('/').pop();
          return `    <link rel="modulepreload" crossorigin href="/assets/${basename}">`;
        })
        .join('\n');

      // Insert just before </head> — robust regardless of Vite's output order
      const insert = `\n    <!-- Critical route preloads -->\n${preloadLinks}\n`;
      html = html.replace('</head>', `${insert}</head>`);

      writeFileSync(htmlPath, html, 'utf-8');
      console.log(
        `[preload-routes] Added modulepreload for: ${criticalFiles.join(', ')}`
      );
    },
  };
}
