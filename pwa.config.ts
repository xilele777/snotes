import type { VitePWAOptions } from 'vite-plugin-pwa'

/** 运行时缓存条目——workbox-build 没在 vite-plugin-pwa 里再导出一次 */
interface RuntimeCacheEntry {
  urlPattern: RegExp
  handler: 'CacheFirst' | 'CacheOnly' | 'NetworkFirst' | 'NetworkOnly' | 'StaleWhileRevalidate'
  options?: { cacheName?: string; expiration?: { maxEntries?: number; maxAgeSeconds?: number } }
}

/**
 * 显式把 manifest 与 workbox 收窄成「始终是对象」的类型，而不是
 * `Partial<ManifestOptions> | false`。原因：`false` 是合法配置值，用 `!`
 * 去不掉它，调用方就得逐处加类型守卫，配置测试会变成一行一个 cast。
 * 这里在源头定死形状，下游 `pwaOptions.manifest.icons` 直接可取。
 */
interface PwaOptions {
  registerType?: 'prompt' | 'autoUpdate'
  includeAssets?: string[]
  manifest: {
    name: string
    short_name: string
    description: string
    display: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
    start_url: string
    background_color: string
    theme_color: string
    icons: { src: string; sizes: string; type: string; purpose?: 'any' | 'maskable' }[]
    shortcuts: { name: string; url: string; icons?: { src: string; sizes: string; type: string }[] }[]
    share_target: { action: string; method: 'GET'; params: { title: string; text: string; url: string } }
  }
  workbox: {
    globPatterns: string[]
    runtimeCaching: RuntimeCacheEntry[]
  }
}

export const pwaOptions: PwaOptions = {
  registerType: 'autoUpdate',
  includeAssets: ['snotes.svg', 'favicon-32.png', 'apple-touch-icon.png', 'snotes-192.png', 'snotes-512.png', 'snotes-maskable-512.png'],
  manifest: {
    name: 'snotes',
    short_name: 'snotes',
    description: '本地优先的 Markdown 便签',
    display: 'standalone',
    start_url: '/',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/snotes-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/snotes-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/snotes-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // 桌面图标长按 / 右键的快捷入口
    shortcuts: [
      { name: '新建笔记', url: '/?new', icons: [{ src: '/snotes-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    // 系统分享面板里选 snotes：文字与链接以 GET 参数进来，启动时由 src/launch.ts 消费。
    // 图片分享需要 POST + Service Worker，暂不做；iOS Safari 不支持 share_target。
    share_target: {
      action: '/?share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [
      {
        // 必须排在通用 API 规则之前
        urlPattern: /^.*\/api\/images\/.*$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'snotes-images',
          expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        // 数据的离线能力由 IndexedDB 提供；SW 缓存 API 响应会造成难以排查的陈旧数据
        urlPattern: /^.*\/api\/.*$/,
        handler: 'NetworkOnly',
      },
    ],
  },
} satisfies Partial<VitePWAOptions>
