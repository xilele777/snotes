import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// Vditor loads its parser, themes and optional renderers dynamically. Ship the
// versioned assets from the installed package for both deployment targets.
export function vditorAssets(): Plugin {
  return {
    name: 'snotes-vditor-assets',
    configResolved(config) {
      const require = createRequire(import.meta.url)
      const packageFile = require.resolve('vditor/package.json')
      const { version } = require(packageFile) as { version: string }
      const target = resolve(config.publicDir, 'vendor/vditor', version)
      mkdirSync(target, { recursive: true })
      cpSync(resolve(packageFile, '../dist'), resolve(target, 'dist'), {
        recursive: true,
        filter: source => !/\.(?:map|ts|less)$/.test(source) && !/[\\/](?:index|method)\.js$/.test(source),
      })
      cpSync(resolve(packageFile, '../LICENSE'), resolve(target, 'LICENSE'))
    },
  }
}
