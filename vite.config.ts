import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.ts'
import { vditorAssets } from './scripts/vditor-assets.ts'

export default defineConfig({
  plugins: [vditorAssets(), vue(), VitePWA(pwaOptions)],
  // Keep temporary HTML reports and historical references out of dev scanning.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: { outDir: 'dist' },
})
