import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  document.querySelectorAll('script[src*="/vendor/vditor/"], [id^="vditor"]').forEach(element => element.remove())
  vi.resetModules()
})

it('并行加载核心资源，同一次在途调用共用请求，重挂载不发同步图标请求', async () => {
  const { loadVditorAssets } = await import('./vditor-assets')
  const first = loadVditorAssets()
  expect(loadVditorAssets()).toBe(first)
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src*="/vendor/vditor/"]')]
  expect(scripts).toHaveLength(3)
  scripts.forEach(script => script.dispatchEvent(new Event('load')))
  await first
  const symbol = document.createElement('span')
  symbol.id = 'vditor-icon-bold'
  document.body.appendChild(symbol)
  document.getElementById('vditorIconScript')!.remove()
  await loadVditorAssets()
  expect(document.getElementById('vditorIconScript')).not.toBeNull()
  expect(document.querySelectorAll('script[src*="/icons/"]')).toHaveLength(0)
})

it('失败的资源可重试，已成功的资源不会重复下载', async () => {
  const { loadVditorAssets } = await import('./vditor-assets')
  const first = loadVditorAssets()
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src*="/vendor/vditor/"]')]
  const failure = expect(first).rejects.toThrow('编辑器资源加载失败')
  scripts[0].dispatchEvent(new Event('error'))
  scripts.slice(1).forEach(script => script.dispatchEvent(new Event('load')))
  await failure
  const retry = loadVditorAssets()
  const pending = [...document.querySelectorAll<HTMLScriptElement>('script[src*="/vendor/vditor/"]')].filter(script => !script.id)
  expect(pending).toHaveLength(1)
  pending[0].dispatchEvent(new Event('load'))
  await retry
})

it('一个资源失败后立即重试，不重复下载其余仍在途的资源', async () => {
  const { loadVditorAssets } = await import('./vditor-assets')
  const first = loadVditorAssets()
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[src*="/vendor/vditor/"]')]
  const failure = expect(first).rejects.toThrow('编辑器资源加载失败')
  scripts[0].dispatchEvent(new Event('error'))
  await failure
  const retry = loadVditorAssets()
  expect(document.querySelectorAll('script[src*="/vendor/vditor/"]')).toHaveLength(3)
  document.querySelectorAll<HTMLScriptElement>('script[src*="/vendor/vditor/"]').forEach(script => script.dispatchEvent(new Event('load')))
  await retry
})
