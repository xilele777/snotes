import { describe, expect, it } from 'vitest'
import { pwaOptions } from '../../pwa.config'

describe('PWA 配置', () => {
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
})
