import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config'
import { vditorAssets } from './scripts/vditor-assets'

export default defineConfig({
  plugins: [vditorAssets(), vue(), VitePWA(pwaOptions)],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: { outDir: 'dist' },
})
