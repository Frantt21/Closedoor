import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import ogTagsPlugin from './plugins/ogTagsPlugin'
import livekitTokenPlugin from './plugins/livekitTokenPlugin'
import preloadRouteChunks from './plugins/preloadRouteChunks'
import inlineCssPlugin from './plugins/inlineCssPlugin'
import { cspPlugin } from './plugins/cspPlugin'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/cdn': {
        target: 'http://api.foranly.space:24587',
        changeOrigin: true,
      },
      // Legacy fallback: /api/music-search → /api/music/search en el music server.
      // DEBE ir ANTES de /api/music para que no matchee por prefijo.
      '/api/music-search': {
        target: 'http://mapi.foranly.space:24633',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/music-search', '/api/music/search'),
      },
      // API de música (búsqueda Deezer, stream yt-dlp, health) en dev:
      // Apunta al servidor remoto (migrado de Termux a servidor con más ancho de banda).
      // Si no está disponible, la petición falla rápido y el frontend usa el
      // fallback de previews (iTunes directo funciona en dev sin server).
      '/api/music': {
        target: 'http://mapi.foranly.space:24633',
        changeOrigin: true,
      },
    },
    allowedHosts: [
      '.ngrok-free.app',
      '.ngrok.io',
      '.ngrok.app',
      true,
    ],
  },
  build: {
    cssMinify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splitting — keep stable libraries in separate chunks
          if (id.includes('/node_modules/react-dom') || id.includes('/node_modules/react/')) {
            return 'vendor-react';
          }
          if (id.includes('/node_modules/@supabase/supabase-js')) {
            return 'vendor-supabase';
          }
          if (id.includes('/node_modules/react-router')) {
            return 'vendor-router';
          }
          if (id.includes('/node_modules/react-toastify')) {
            return 'vendor-toastify';
          }
        },
      },
    },
  },
  plugins: [
    ogTagsPlugin(),
    livekitTokenPlugin(),
    preloadRouteChunks(),
    inlineCssPlugin(),
    cspPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
