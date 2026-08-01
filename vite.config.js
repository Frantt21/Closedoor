import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import ogTagsPlugin from './plugins/ogTagsPlugin'
import livekitTokenPlugin from './plugins/livekitTokenPlugin'
import preloadRouteChunks from './plugins/preloadRouteChunks'
import inlineCssPlugin from './plugins/inlineCssPlugin'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/cdn': {
        target: 'http://api.foranly.space:24587',
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
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
