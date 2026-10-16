import { ref } from 'vue'

/** Toast 停留时长；复制、下载这类提示看一眼就够，不需要手动关 */
export const NOTICE_MS = 3500

/** 当前显示的提示文字，空串表示没有；Toast.vue 渲染它，单测直接断言它 */
export const notice = ref('')
export const noticeAction = ref<{ label: string; run: () => void | Promise<void> } | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined

/**
 * 顶部 Toast：只保留一条，新消息替换旧消息并重新计时，普通消息 3.5 秒、带操作的消息 5 秒后自动消失。
 * 放在顶部是因为手机浏览器工具栏、系统手势区和软键盘都在屏幕底边，底栏提示经常被挡住。
 */
export function notify(text: string, action?: { label: string; run: () => void | Promise<void> }): void {
  clearTimeout(timer)
  notice.value = text
  noticeAction.value = action ?? null
  timer = setTimeout(dismissNotice, action ? 5000 : NOTICE_MS)
}

export async function runNoticeAction(): Promise<void> {
  const action = noticeAction.value
  dismissNotice()
  try { await action?.run() } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
}

export function dismissNotice(): void {
  clearTimeout(timer)
  notice.value = ''
  noticeAction.value = null
}
