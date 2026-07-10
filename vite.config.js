import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import ogTagsPlugin from './plugins/ogTagsPlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    ogTagsPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})
