import { build } from 'esbuild'
import { build as buildFrontend } from 'vite'

process.env.VITE_DEPLOY_TARGET = 'server'
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
