import { build } from 'esbuild'
import { build as buildFrontend } from 'vite'

await buildFrontend()

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
})
