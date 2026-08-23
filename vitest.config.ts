import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts', 'shared/**/*.test.ts'],
    setupFiles: ['./tests/unit/setup-idb.ts'],
  },
})
