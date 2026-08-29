import type { OpensSyncRequest, OpensSyncResponse } from '../../shared/types'
import { apiFetch } from '../api/client'
import { hasToken } from '../api/token'
import { getMeta, setMeta } from '../db/repo'
import { db } from '../db/schema'

export const OPENS_THROTTLE_MS = 60_000
const DEVICE_ID_KEY = 'device_id'
const CURSOR_KEY = 'opens_cursor'
const DIRTY_KEY = 'opens_dirty'

let timer: ReturnType<typeof setTimeout> | undefined
let lastStarted: number | null = null
let inFlight: Promise<void> | null = null

async function deviceId(): Promise<string> {
  let id = await getMeta<string>(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    await setMeta(DEVICE_ID_KEY, id)
  }
  return id
}

/** 上报本设备累积值，同时拉取其它设备聚合值。 */
export async function syncOpens(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const [id, since, dirty] = await Promise.all([
      deviceId(),
      getMeta<number>(CURSOR_KEY),
      getMeta<string[]>(DIRTY_KEY),
    ])
    const snapshot = [...new Set(dirty ?? [])]
    const rows = await db.notes.bulkGet(snapshot)
    const items = rows.flatMap((note) => note ? [{
      note_id: note.id,
      count: note.open_count ?? 0,
      last_open_time: note.last_open_time ?? 0,
    }] : [])
    const request: OpensSyncRequest = { device_id: id, since: since ?? 0, items }
    const response = await apiFetch<OpensSyncResponse>('/api/notes/opens', {
      method: 'POST', body: JSON.stringify(request),
    })

    await db.transaction('rw', db.notes, db.meta, async () => {
      for (const open of response.opens) {
        const note = await db.notes.get(open.note_id)
        if (note) await db.notes.update(open.note_id, {
          open_others: open.others_count,
          open_others_time: open.others_last_open_time,
        })
      }
      // 只清本次快照：请求飞行期间产生的新增打开仍留在 dirty 中。
      const current = (await db.meta.get(DIRTY_KEY))?.value as string[] | undefined
      const sent = new Set(snapshot)
      await db.meta.put({ key: DIRTY_KEY, value: (current ?? []).filter((noteId) => !sent.has(noteId)) })
      await db.meta.put({ key: CURSOR_KEY, value: response.server_time })
    })
  })().finally(() => { inFlight = null })
  return inFlight
}

export function scheduleOpensSync(): void {
  // 未登录时只保留 dirty；令牌可用后由同步引擎的首轮/轮询发送。
  if (!hasToken.value) return
  const delay = lastStarted === null ? 0 : Math.max(0, OPENS_THROTTLE_MS - (Date.now() - lastStarted))
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    lastStarted = Date.now()
    // 打开统计不影响正文同步；后台失败保留 dirty，留给后续轮询重试。
    void syncOpens().catch(() => undefined)
  }, delay)
}

export async function flushOpensSync(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  lastStarted = Date.now()
  await syncOpens()
}
