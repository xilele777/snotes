/**
 * 启动意图：PWA 的 share_target（GET）与 manifest shortcuts 都是靠 URL 参数把
 * 「要做什么」带进应用的。这里只解析参数，不碰任何状态，便于纯函数测试。
 */
export type LaunchIntent =
  | { kind: 'new'; body: string }
  | null

/** 把系统分享面板给的标题、正文、链接拼成一条笔记的 Markdown。 */
export function composeSharedNote(title: string, text: string, url: string): string {
  const parts: string[] = []
  const t = title.trim()
  const body = text.trim()
  const link = url.trim()
  if (t) parts.push(`# ${t}`)
  // 部分平台会把链接同时塞进 text 和 url，避免重复
  if (body && body !== link) parts.push(body)
  if (link) parts.push(link)
  return parts.join('\n\n')
}

export function parseLaunchIntent(search: string): LaunchIntent {
  const params = new URLSearchParams(search)
  if (params.has('share')) {
    return {
      kind: 'new',
      body: composeSharedNote(params.get('title') ?? '', params.get('text') ?? '', params.get('url') ?? ''),
    }
  }
  if (params.has('new')) return { kind: 'new', body: '' }
  return null
}

/** 意图消费完后把参数从地址栏擦掉，刷新时不会再建一条。 */
export function clearLaunchParams() {
  const url = new URL(location.href)
  if (![...url.searchParams.keys()].length) return
  url.search = ''
  history.replaceState(history.state, '', url.toString())
}
