import type { VitePWAOptions } from 'vite-plugin-pwa'
import { version as vditorVersion } from 'vditor/package.json'

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
  injectRegister: null
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
    clientsClaim: boolean
    globPatterns: string[]
    globIgnores: string[]
    additionalManifestEntries: { url: string; revision: null }[]
    ignoreURLParametersMatching: RegExp[]
    maximumFileSizeToCacheInBytes: number
    runtimeCaching: RuntimeCacheEntry[]
  }
}

export const pwaOptions: PwaOptions = {
  // 编辑器有未提交输入时不能被 Service Worker 静默 reload；由应用在安全时机提示更新。
  registerType: 'prompt',
  injectRegister: null,
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
    // 首次安装立即接管，后续版本仍等待用户确认，不自动 skipWaiting。
    clientsClaim: true,
    // Only pre-cache the parser, Chinese locale and default icons. Optional
    // diagrams, math renderers, emoji and fonts are cached when requested.
    globPatterns: ['**/*.{js,css,html,ico,png,svg,gif,jpg,jpeg,webp,woff,woff2,ttf}'],
    globIgnores: ['vendor/**'],
    additionalManifestEntries: [
      'js/lute/lute.min.js', 'js/i18n/zh_CN.js', 'js/icons/ant.js',
      'css/content-theme/light.css', 'css/content-theme/dark.css',
      'js/highlight.js/styles/github.min.css', 'js/highlight.js/styles/github-dark.min.css',
    ].map(path => ({ url: `/vendor/vditor/${vditorVersion}/dist/${path}`, revision: null })),
    // Vditor appends ?v= to its local parser, renderer and theme URLs.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    runtimeCaching: [
      {
        urlPattern: /^https?:\/\/[^/]+\/vendor\/vditor\/[^/]+\/dist\//,
        handler: 'CacheFirst',
        options: {
          cacheName: 'snotes-vditor',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
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
