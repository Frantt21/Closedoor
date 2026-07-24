import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import ogTagsPlugin from './plugins/ogTagsPlugin'

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
  },
  plugins: [
    ogTagsPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
