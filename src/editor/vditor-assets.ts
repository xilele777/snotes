import { VDITOR_CDN } from './vditor-options'

let loading: Promise<void> | undefined
const pendingScripts = new Map<string, Promise<void>>()

function script(path: string, id: string): Promise<void> {
  const pending = pendingScripts.get(id)
  if (pending) return pending
  if (document.getElementById(id)) return Promise.resolve()
  if (id === 'vditorIconScript' && document.getElementById('vditor-icon-bold')) {
    // destroy() removes the script marker but leaves the sprite. Recreate
    // the marker so remounting does not duplicate the sprite or use sync XHR.
    const marker = document.createElement('script')
    marker.id = id
    document.head.appendChild(marker)
    return Promise.resolve()
  }
  const request = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script')
    element.src = `${VDITOR_CDN}/dist/${path}`
    element.async = true
    const fail = () => {
      clearTimeout(timeout)
      element.onload = element.onerror = null
      element.remove()
      reject(new Error('编辑器资源加载失败，请检查网络后重试'))
    }
    const timeout = setTimeout(fail, 15_000)
    element.onload = () => { clearTimeout(timeout); element.id = id; resolve() }
    element.onerror = fail
    document.head.appendChild(element)
  }).finally(() => { pendingScripts.delete(id) })
  pendingScripts.set(id, request)
  return request
}

/** Load independent assets in parallel. Vditor normally chains locale -> Lute
 * and finally loads toolbar icons with a synchronous XMLHttpRequest. Supplying
 * its expected script IDs avoids that main-thread-blocking request entirely. */
export function loadVditorAssets(): Promise<void> {
  return loading ??= Promise.all([
    script('js/i18n/zh_CN.js', 'vditorI18nScriptzh_CN'),
    script('js/lute/lute.min.js', 'vditorLuteScript'),
    script('js/icons/ant.js', 'vditorIconScript'),
  ]).then(() => undefined).finally(() => { loading = undefined })
}
