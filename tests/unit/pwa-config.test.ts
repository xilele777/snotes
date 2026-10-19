import { describe, expect, it } from 'vitest'
import { pwaOptions } from '../../pwa.config'

describe('PWA 配置', () => {
  it('更新等待用户确认，但首次安装接管页面以支持离线缓存', () => {
    expect(pwaOptions.registerType).toBe('prompt')
    expect(pwaOptions.workbox.clientsClaim).toBe(true)
  })
  it('仅预缓存编辑器核心，复杂渲染器按需缓存', () => {
    expect(pwaOptions.workbox.globIgnores).toContain('vendor/**')
    const core = pwaOptions.workbox.additionalManifestEntries.map(entry => entry.url)
    expect(core.some(url => url.endsWith('/js/lute/lute.min.js'))).toBe(true)
    expect(core.some(url => /mermaid|graphviz|mathjax|echarts/.test(url))).toBe(false)
    const runtime = pwaOptions.workbox.runtimeCaching.find(rule =>
      rule.urlPattern.test('https://example.test/vendor/vditor/4.0.0/dist/js/mermaid/mermaid.min.js')
    )
    expect(runtime?.handler).toBe('CacheFirst')
  })
  it('manifest 为 standalone 且 start_url 为根', () => {
    expect(pwaOptions.manifest).toMatchObject({
      display: 'standalone',
      start_url: '/',
    })
  })

  it('提供 192 与 512 两种图标', () => {
    const sizes = pwaOptions.manifest!.icons!.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('图片走 CacheFirst，离线可看图', () => {
    const rule = pwaOptions.workbox!.runtimeCaching!.find((r) =>
      String(r.urlPattern).includes('images')
    )
    expect(rule!.handler).toBe('CacheFirst')
  })

  it('其余 API 一律 NetworkOnly——离线数据由 IndexedDB 负责', () => {
    const rule = pwaOptions.workbox!.runtimeCaching!.find(
      (r) => String(r.urlPattern).includes('api') && !String(r.urlPattern).includes('images')
    )
    expect(rule!.handler).toBe('NetworkOnly')
  })

  it('图片规则排在 API 规则之前，否则会被 NetworkOnly 抢先匹配', () => {
    const rules = pwaOptions.workbox!.runtimeCaching!
    const imageIdx = rules.findIndex((r) => String(r.urlPattern).includes('images'))
    const apiIdx = rules.findIndex(
      (r) => String(r.urlPattern).includes('api') && !String(r.urlPattern).includes('images')
    )

    expect(imageIdx).toBeLessThan(apiIdx)
  })

  it('分享目标用 GET 且带 share 标记参数，快捷入口能新建笔记', () => {
    expect(pwaOptions.manifest.share_target.method).toBe('GET')
    expect(pwaOptions.manifest.share_target.action).toContain('share')
    expect(pwaOptions.manifest.shortcuts.map((s) => s.url)).toContain('/?new')
  })
})
