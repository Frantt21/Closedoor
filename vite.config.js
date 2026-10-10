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
      // API de música en dev: la sirve server.js (npm start) con el resolver
      // innertube local. Si no está corriendo, la petición falla rápido y el
      // frontend cae al preview de 30 s (iTunes directo sigue funcionando).
      // `/api/music-search` DEBE ir antes que `/api/music` (prefijo).
      '/api/music-search': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/music': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy de imágenes CORS (wallhaven, etc. bloquean el fetch del navegador):
      // el server baja la imagen y la devuelve con CORS *, igual que en Vercel.
      '/api/image-proxy': {
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
