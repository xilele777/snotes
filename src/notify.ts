import { ref } from 'vue'

/** Toast 停留时长；复制、下载这类提示看一眼就够，不需要手动关 */
export const NOTICE_MS = 3500
/** 带操作的提示（如撤销）停留更久 */
const ACTION_NOTICE_MS = 5000
/** 排队等待展示的消息上限：防突发风暴排成长串，超出丢最旧的 */
const QUEUE_LIMIT = 3

/** 当前显示的提示文字，空串表示没有；Toast.vue 渲染它，单测直接断言它 */
export const notice = ref('')
export const noticeAction = ref<{ label: string; run: () => void | Promise<void> } | null>(null)

interface NoticeEntry { text: string; action: { label: string; run: () => void | Promise<void> } | null }
const queue: NoticeEntry[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function show(entry: NoticeEntry) {
  notice.value = entry.text
  noticeAction.value = entry.action
  timer = setTimeout(expire, entry.action ? ACTION_NOTICE_MS : NOTICE_MS)
}

function expire() {
  const next = queue.shift()
  if (next) show(next)
  else {
    notice.value = ''
    noticeAction.value = null
  }
}

/**
 * 顶部 Toast：同一时刻只显示一条。普通消息新到即替换旧的并重新计时；
 * 带操作的消息（如撤销）不会被后来的消息顶掉——它的动作一旦被顶掉就永远
 * 丢了（连删两条笔记时第一条的撤销就没处可点）——后来者排队，等它展示完
 * 再上。放在顶部是因为手机浏览器工具栏、系统手势区和软键盘都在屏幕底边，
 * 底栏提示经常被挡住。
 */
export function notify(text: string, action?: { label: string; run: () => void | Promise<void> }): void {
  const entry: NoticeEntry = { text, action: action ?? null }
  if (notice.value !== '' && noticeAction.value) {
    queue.push(entry)
    while (queue.length > QUEUE_LIMIT) queue.shift()
    return
  }
  clearTimeout(timer)
  queue.length = 0
  show(entry)
}

export async function runNoticeAction(): Promise<void> {
  const action = noticeAction.value
  dismissNotice()
  try { await action?.run() } catch (error) { notify(error instanceof Error ? error.message : String(error)) }
}

/** 用户主动处理/关闭提示：清掉当前与所有排队中的提示 */
export function dismissNotice(): void {
  clearTimeout(timer)
  queue.length = 0
  notice.value = ''
  noticeAction.value = null
}
