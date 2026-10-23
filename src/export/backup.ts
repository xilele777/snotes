import { IMAGE_URL_PREFIX } from '../../shared/derive'
import { noteFits } from '../../shared/limits'
import { archiveFilter, MAX_ARCHIVE_BYTES } from './archive'
import type { LocalNote, NoteBody } from '../../shared/types'
import type { Zippable } from 'fflate'
import { apiBlob, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { createNote, trashNote } from '../db/repo'
import { createKnowledgeBase, metadata, knowledgeBaseTables, snapshotIn } from '../db/knowledge-base-repo'
import { validId, validateKnowledgeBaseMeta, validateToc } from '../../shared/knowledge-base'
import type { KnowledgeBaseMeta, TocNode } from '../../shared/knowledge-base'
import type { KnowledgeBaseHistory } from '../db/knowledge-base-types'
import { uploadImage } from '../editor/image-upload'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { emitLocalWrite } from '../sync/signal'

/** 备份包的格式版本；将来结构有不兼容变化时靠它决定怎么读。 */
export const BACKUP_FORMAT = 3
export const INDEX_FILE = 'index.json'
export const IMAGES_DIR = 'images'
/** 未分组笔记在包内的文件夹名。 */
export const UNGROUPED_DIR = '未分组'

/** 正文里指向本站图片的引用，file_key 形如 `<noteId>/<uuid>.jpg`。 */
const IMAGE_REF_RE = /(?<![^\s("'<>])\/api\/images\/([^\s)"'<>\]]+)/g
/** 导入时认的图片相对引用：`images/x.jpg` 或 `../images/x.jpg`。 */
const RELATIVE_IMAGE_RE = /(?<![^\s("'<>])(?:\.\.\/)?images\/([^\s)"'<>\]]+)/g

export interface BackupGroup {
  group_id: string
  name: string
  ord: number
  color: string | null
  /** 组内笔记默认不上首页信息流；旧备份没有这个字段，按 0 处理 */
  hide_from_home?: 0 | 1
  update_time: number
}

export interface BackupNote {
  id: string
  group_id: string | null
  title: string
  star: 0 | 1
  top: 0 | 1
  skin_color: string | null
  /** 首页信息流覆盖值：0 / 1 是显式设置，null / 缺失表示跟随分组 */
  home_hidden?: 0 | 1 | null
  create_time: number
  update_time: number
  /** 笔记在包内的路径，导入时按它把 index.json 和正文对上 */
  file: string
  /** Format 2 includes referenced trashed notes without restoring them as active. */
  invalid?: 0 | 1
}

export interface BackupKnowledgeBase extends KnowledgeBaseMeta {
  id: string
  create_time: number
  nodes: TocNode[]
  note_states: Record<string, 'available' | 'trash' | 'purged'>
}

export interface BackupIndex {
  app: 'snotes'
  format: number
  exported_at: number
  groups: BackupGroup[]
  notes: BackupNote[]
  knowledge_bases?: BackupKnowledgeBase[]
  knowledge_base_histories?: KnowledgeBaseHistory[]
  note_histories?: { note_id: string; time: number; file: string }[]
}

export interface BackupProgress {
  done: number
  total: number
  label: string
}

export type ProgressReporter = (progress: BackupProgress) => void

/**
 * 把任意标题变成安全且可读的文件名/文件夹名。
 * 保留中文，去掉路径分隔符与 Windows 禁用字符；首尾的点和空格会让某些系统
 * 存不下或看不见文件，一并去掉；过长会撑爆路径长度，截到 60 字。
 */
export function safeName(raw: string, fallback = '无标题'): string {
  const cleaned = Array.from(raw ?? '')
    .map((ch) => (ch.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')

  const cut = cleaned.slice(0, 60)
  const name = cut || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name
}

/** 同名时补 -2、-3……保证一个目录里不会有两条一样的路径。 */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/** 笔记路径重名时在扩展名前加序号：`工作/周报.md` → `工作/周报-2.md`。 */
function uniquePath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path)
    return path
  }
  const stem = path.replace(/\.md$/i, '')
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}.md`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * 组装包内路径：一个分组一个文件夹，一个笔记一个 .md。
 * 分组文件夹名和文件路径各去重一次——同名分组合并成一个文件夹，
 * 同目录下的重名笔记才会被加上序号。
 */
function assignPaths(notes: { title: string; group_id: string | null }[], groupNames: Map<string, string>): string[] {
  const dirByGroup = new Map<string, string>()
  const usedPaths = new Set<string>()

  return notes.map((note) => {
    const key = note.group_id ?? ''
    let dir = dirByGroup.get(key)
    if (!dir) {
      dir = uniqueName(safeName(groupNames.get(key) ?? UNGROUPED_DIR, UNGROUPED_DIR), new Set(dirByGroup.values()))
      dirByGroup.set(key, dir)
    }
    return uniquePath(`${dir}/${safeName(note.title)}.md`, usedPaths)
  })
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export function mimeOfFile(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null : null
}

/**
 * 本地没有正文（pull 下来但从未打开）的笔记补拉一次正文。
 * 备份包里少一条正文等于数据丢了，所以这里失败就冒泡，让调用方提示用户重试。
 */
async function fillBodies(notes: LocalNote[], report: ProgressReporter): Promise<void> {
  const missing = notes.filter((n) => n.body_version === 0 && n.dirty !== 'body' && n.dirty !== 'both').map((n) => n.id)
  if (missing.length === 0) return

  const byId = new Map(notes.map((n) => [n.id, n]))
  const BATCH = 50
  for (let i = 0; i < missing.length; i += BATCH) {
    report({ done: i, total: missing.length, label: '正在读取正文' })
    const response = await apiFetch<{ bodies: NoteBody[] }>('/api/sync/bodies', {
      method: 'POST',
      body: JSON.stringify({ ids: missing.slice(i, i + BATCH) }),
    })
    for (const body of response.bodies) {
      const note = byId.get(body.note_id)
      if (note) note.body = body.content
    }
    if (missing.slice(i, i + BATCH).some(id => !response.bodies.some(b => b.note_id === id))) throw new Error('部分笔记正文尚未下载，无法完成备份')
  }
}

export interface BackupBundle {
  blob: Blob
  notes: number
  groups: number
  images: number
  /** 有图片没能下载下来时给出数量，界面上要如实告诉用户 */
  missingImages: number
  knowledgeBases: number
}

/**
 * 导出全部笔记为 zip：每个分组一个文件夹、每条笔记一个 .md，
 * 图片下载后放进 images/ 并把正文里的引用改写成相对路径。
 * zip 库按需加载，不进首屏。
 */
export async function buildBackup(report: ProgressReporter = () => {}, format: 1 | 2 | 3 = BACKUP_FORMAT): Promise<BackupBundle> {
  const { strToU8, zipSync } = await import('fflate')

  const snapshot = await db.transaction('r', [db.notes, db.groups, db.history, ...knowledgeBaseTables()], async () => ({
    groups: await db.groups.toArray(), noteHistory: await db.history.toArray(),
    notes: await db.notes.toArray(), books: await db.knowledgeBases.toArray(), tocs: await db.knowledgeBaseTocs.toArray(),
    states: await db.knowledgeBaseNoteStates.toArray(), history: await db.knowledgeBaseTocHistory.toArray(),
  }))
  snapshot.books = snapshot.books.filter(b => !b.deleted)
  const bookIds = new Set(snapshot.books.map(b => b.id))
  snapshot.tocs = snapshot.tocs.filter(t => bookIds.has(t.knowledge_base_id))
  snapshot.history = snapshot.history.filter(h => bookIds.has(h.book_id))
  const referenced = new Set([...snapshot.tocs, ...snapshot.history].flatMap(t => t.nodes.flatMap(n => n.note_id ? [n.note_id] : [])))
  const all = snapshot.notes.filter(n => n.invalid === 0 || (format === 3 || format === 2 && referenced.has(n.id)) && n.invalid === 1)
  const groups = snapshot.groups.filter((g) => g.invalid === 0).sort((a, b) => a.ord - b.ord)

  report({ done: 0, total: all.length, label: '正在整理笔记' })
  await fillBodies(all, report)

  const groupNames = new Map<string, string>(groups.map((g) => [g.group_id, g.name]))
  const sorted = [...all].sort(
    (a, b) => (a.group_id ?? '').localeCompare(b.group_id ?? '') || a.create_time - b.create_time
  )
  const paths = assignPaths(sorted, groupNames)

  const files: Zippable = {}
  const index: BackupIndex = {
    app: 'snotes',
    format,
    exported_at: Date.now(),
    groups: groups.map((g) => ({
      group_id: g.group_id,
      name: g.name,
      ord: g.ord,
      color: g.color,
      hide_from_home: g.hide_from_home ?? 0,
      update_time: g.update_time,
    })),
    notes: [],
    ...(format >= 2 ? {
      knowledge_bases: snapshot.books.map(book => ({ ...metadata(book), id: book.id, create_time: book.create_time,
        nodes: snapshot.tocs.find(t => t.knowledge_base_id === book.id)?.nodes ?? [],
        note_states: Object.fromEntries(snapshot.states.map(s => [s.id, s.state])),
      })), knowledge_base_histories: snapshot.history,
    } : {}),
  }

  // 先扫一遍所有正文，把图片引用收齐——同一张图可能被多条笔记引用，只下载一次。
  const imageKeys: string[] = []
  const seenKeys = new Set<string>()
  const noteIds = new Set(sorted.map(n => n.id))
  const history = format === 3 ? snapshot.noteHistory.filter(h => noteIds.has(h.note_id)) : []
  for (const note of [...sorted, ...history]) {
    for (const match of note.body.matchAll(IMAGE_REF_RE)) {
      const key = match[1]
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        imageKeys.push(key)
      }
    }
  }

  const imagePaths = new Map<string, string>()
  const usedImageNames = new Set<string>()
  let missingImages = 0
  for (let i = 0; i < imageKeys.length; i++) {
    const key = imageKeys[i]
    report({ done: i, total: imageKeys.length, label: '正在打包图片' })
    const base = key.slice(key.lastIndexOf('/') + 1) || key
    const path = `${IMAGES_DIR}/${uniqueName(safeName(base, 'image'), usedImageNames)}`
    try {
      const blob = await apiBlob(IMAGE_URL_PREFIX + key)
      // 图片本身已经压过，再走一遍 deflate 只是白花时间。
      files[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
      imagePaths.set(key, path)
    } catch {
      // 下载失败就保留原地址：包还是完整的，图在外面也能打开
      missingImages++
    }
  }

  sorted.forEach((note, i) => {
    const path = paths[i]
    const body = note.body.replace(IMAGE_REF_RE, (whole, key: string) => {
      const replaced = imagePaths.get(key)
      // 笔记在分组文件夹下，图片在包根的 images/，所以要退回一层
      return replaced ? `../${replaced}` : whole
    })

    files[path] = strToU8(body)
    index.notes.push({
      id: note.id,
      group_id: note.group_id && groupNames.has(note.group_id) ? note.group_id : null,
      title: note.title,
      star: note.star,
      top: note.top,
      skin_color: note.skin_color,
      home_hidden: note.home_hidden ?? null,
      create_time: note.create_time,
      update_time: note.update_time,
      file: path,
      ...(format >= 2 ? { invalid: note.invalid as 0 | 1 } : {}),
    })
    report({ done: i + 1, total: sorted.length, label: '正在写入笔记' })
  })

  if (format === 3) index.note_histories = history.map((h, i) => {
    const file = `history/${i}.txt`
    files[file] = strToU8(h.body.replace(IMAGE_REF_RE, (whole, key: string) => imagePaths.get(key) ? `../${imagePaths.get(key)}` : whole))
    return { note_id: h.note_id, time: h.time, file }
  })
  files[INDEX_FILE] = strToU8(JSON.stringify(index, null, 2))

  const zipped = zipSync(files)
  return {
    blob: new Blob([new Uint8Array(zipped)], { type: 'application/zip' }),
    notes: sorted.length,
    groups: groups.length,
    images: imagePaths.size,
    missingImages,
    knowledgeBases: format >= 2 ? snapshot.books.length : 0,
  }
}

export interface ImportResult {
  notes: number
  /** 本次新建的笔记，供独立 Markdown 入口定位并打开。 */
  noteIds: string[]
  /** 已经存在（id 相同）而跳过的条数，重复导入同一份包不会产生副本 */
  skipped: number
  noteConflicts: number
  groups: number
  images: number
  failedImages: number
  knowledgeBases: number
  knowledgeBaseConflicts: number
  missingReferences: number
}

interface StagedNote {
  path: string
  body: string
  meta?: BackupNote
  id?: string
}

/** 从 zip 里读出 index.json；没有或者是别的格式就返回 null。 */
function readIndex(entries: Record<string, Uint8Array>, strFromU8: (d: Uint8Array) => string): BackupIndex | null {
  const raw = entries[INDEX_FILE]
  if (!raw) return null
  const parsed = JSON.parse(strFromU8(raw)) as BackupIndex
  if (parsed?.app !== 'snotes') return null
  if (![1, 2, 3].includes(parsed.format)) throw new Error('不支持的备份格式，请升级应用后导入')
  if (!Array.isArray(parsed.notes) || !Array.isArray(parsed.groups)) throw new Error('备份索引不完整')
  const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
  const validColor = (value: string | null) => value === null || typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  const groupIds = new Set<string>()
  for (const group of parsed.groups) {
    if (!group || !validId(group.group_id) || groupIds.has(group.group_id)
      || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 100
      || !Number.isSafeInteger(group.ord) || !validColor(group.color) || !validTime(group.update_time)
      || group.hide_from_home !== undefined && group.hide_from_home !== 0 && group.hide_from_home !== 1) throw new Error('备份分组信息无效')
    groupIds.add(group.group_id)
  }
  const noteIds = new Set<string>()
  const noteFiles = new Set<string>()
  for (const note of parsed.notes) {
    if (!note || !validId(note.id) || noteIds.has(note.id) || typeof note.file !== 'string'
      || !/\.md$/i.test(note.file) || noteFiles.has(note.file) || !Object.hasOwn(entries, note.file)
      || typeof note.title !== 'string' || !validTime(note.create_time) || !validTime(note.update_time)
      || note.group_id !== null && !groupIds.has(note.group_id)
      || ![0, 1].includes(note.star) || ![0, 1].includes(note.top) || !validColor(note.skin_color)
      || note.home_hidden !== undefined && note.home_hidden !== null && note.home_hidden !== 0 && note.home_hidden !== 1
      || note.invalid !== undefined && note.invalid !== 0 && note.invalid !== 1) throw new Error('备份笔记索引或正文不完整')
    noteIds.add(note.id)
    noteFiles.add(note.file)
  }
  if (parsed.format >= 2) {
    if (!Array.isArray(parsed.knowledge_bases) || !Array.isArray(parsed.knowledge_base_histories)) throw new Error('笔记本备份不完整')
    const ids = new Set<string>()
    for (const book of parsed.knowledge_bases) {
      if (!book || !validId(book.id) || ids.has(book.id) || !validTime(book.create_time)) throw new Error('笔记本备份信息无效')
      ids.add(book.id)
      validateKnowledgeBaseMeta(book)
      validateToc(book.nodes)
      if (!book.note_states || typeof book.note_states !== 'object' || Object.entries(book.note_states).some(([id, state]) => !validId(id) || !['available', 'trash', 'purged'].includes(state))) throw new Error('笔记引用状态无效')
    }
    const historyIds = new Set<string>()
    for (const h of parsed.knowledge_base_histories) {
      if (!h || !validId(h.id) || historyIds.has(h.id) || !ids.has(h.book_id) || !validTime(h.time) || !['confirmed', 'conflict', 'discarded'].includes(h.source)) throw new Error('笔记本快照无效')
      historyIds.add(h.id)
      validateToc(h.nodes)
      if (h.meta) validateKnowledgeBaseMeta(h.meta)
    }
  }
  if (parsed.format === 3) {
    if (!Array.isArray(parsed.note_histories)) throw new Error('笔记历史备份不完整')
    for (const h of parsed.note_histories) {
      if (!h || !noteIds.has(h.note_id) || !validTime(h.time) || typeof h.file !== 'string'
        || !/^history\/[0-9]+\.txt$/.test(h.file) || noteFiles.has(h.file) || !Object.hasOwn(entries, h.file)
        || !noteFits(strFromU8(entries[h.file]!))) throw new Error('笔记历史备份无效')
      noteFiles.add(h.file)
    }
  }
  return parsed
}

/**
 * 导入 .md 或备份 zip。
 * 有 index.json 就按它还原分组、星标、置顶、颜色和创建时间；没有就按文件夹名建分组。
 * 正文里的图片重新上传到当前实例并改写引用，最后统一走 repo.createNote，
 * 因此导入的笔记和手写的一样会进入同步队列。
 */
export async function importBackup(
  picked: File[],
  report: ProgressReporter = () => {}
): Promise<ImportResult> {
  const result: ImportResult = { notes: 0, noteIds: [], skipped: 0, noteConflicts: 0, groups: 0, images: 0, failedImages: 0, knowledgeBases: 0, knowledgeBaseConflicts: 0, missingReferences: 0 }

  const staged: StagedNote[] = []
  /** 包内路径 → 图片字节，导入时按需上传 */
  const imageBytes = new Map<string, Uint8Array>()
  let index: BackupIndex | null = null
  const histories: { note_id: string; time: number; body: string }[] = []

  if (picked.reduce((total, file) => total + file.size, 0) > MAX_ARCHIVE_BYTES) throw new Error('一次导入的文件总大小不能超过 100 MiB')
  const filter = archiveFilter()

  for (const file of picked) {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip'
    if (!isZip) {
      const raw = safeName(file.name.replace(/\.(md|markdown|txt)$/i, ''), '无标题')
      const body = await file.text()
      if (!noteFits(body)) throw new Error('单篇正文不能超过 1 MiB，请拆分后导入')
      staged.push({ path: raw, body })
      continue
    }

    // 普通 Markdown 无需加载 ZIP 解压库。
    const { strFromU8, unzipSync } = await import('fflate')
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter })
    const parsed = readIndex(entries, strFromU8)
    if (parsed && picked.length !== 1) throw new Error('带索引的备份包请单独导入，避免正文路径与其他文件混淆')
    if (parsed && index) throw new Error('请一次导入一个带索引的备份包')
    index = parsed ?? index
    for (const h of parsed?.note_histories ?? []) histories.push({ note_id: h.note_id, time: h.time, body: strFromU8(entries[h.file]!) })
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/')) continue
      if (/\.md$/i.test(path)) {
        const body = strFromU8(data)
        if (!noteFits(body)) throw new Error('单篇正文不能超过 1 MiB，请拆分后导入')
        staged.push({ path, body })
      } else if (path.startsWith(`${IMAGES_DIR}/`)) {
        imageBytes.set(path, data)
      }
    }
  }

  const metaByFile = new Map((index?.notes ?? []).map((n) => [n.file, n]))
  const groups = useGroupsStore()
  const urlByImagePath = new Map<string, string>()
  // Network work must finish before opening IndexedDB's write transaction.
  // No groups, notes or sync tasks are committed if a required image fails.
  for (const item of staged) {
    item.meta = metaByFile.get(item.path)
    item.id = item.meta?.id ?? crypto.randomUUID()
    item.body = await replaceImageRefs(item.body, item.id, imageBytes, urlByImagePath, result, report)
    if (!noteFits(item.body)) throw new Error('图片地址替换后正文超过 1 MiB，请拆分后导入')
  }

  for (const h of histories) {
    h.body = await replaceImageRefs(h.body, h.note_id, imageBytes, urlByImagePath, result, report)
    if (!noteFits(h.body)) throw new Error('图片地址替换后历史正文超过 1 MiB')
  }

  await db.transaction('rw', [db.notes, db.groups, db.outbox, db.history, db.meta, ...knowledgeBaseTables()], async () => {

    // 分组按名字对齐：本机已有同名分组就直接复用，没有才新建。
    // 重复导入同一个备份、或备份里的分组与本机重名，都不该再多出一个同名分组。
    const groupIdByName = new Map<string, string>()
    for (const g of await db.groups.toArray()) if (!g.invalid) groupIdByName.set(g.name, g.group_id)
    async function ensureGroup(name: string, color?: string | null, hideFromHome?: 0 | 1): Promise<string> {
      const existing = groupIdByName.get(name)
      if (existing) return existing
      const created = await groups.create(name, { color, hide_from_home: hideFromHome })
      groupIdByName.set(name, created.group_id)
      result.groups++
      return created.group_id
    }

    // index.json 里有记录的分组先对齐好，剩下的按文件夹名现建。
    const groupIdByOldId = new Map<string, string>()
    if (index) {
      for (const g of index.groups) {
        groupIdByOldId.set(g.group_id, await ensureGroup(g.name, g.color, g.hide_from_home ?? 0))
      }
    }

    const total = staged.length

    for (let i = 0; i < total; i++) {
      const item = staged[i]
      report({ done: i, total, label: '正在导入笔记' })

      const meta = item.meta
      const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''

      let groupId: string | null = null
      if (meta?.group_id) {
        groupId = groupIdByOldId.get(meta.group_id) ?? null
      } else if (dir && dir !== UNGROUPED_DIR) {
        groupId = await ensureGroup(safeName(dir, UNGROUPED_DIR))
      }

      // 已经导入过（或本来就是本机的笔记）就跳过，重复导入不会翻倍。
      const existing = meta ? await db.notes.get(meta.id) : undefined
      if (existing) {
        if (existing.body !== item.body) {
          const histories = await db.history.where('note_id').equals(existing.id).toArray()
          if (!histories.some(history => history.body === item.body)) {
            await db.history.add({ note_id: existing.id, body: item.body, time: meta!.update_time })
          }
          result.noteConflicts++
        }
        result.skipped++
        continue
      }
      const id = item.id!

      await createNote(item.body, {
        id,
        group_id: groupId,
        star: meta?.star ?? 0,
        top: meta?.top ?? 0,
        skin_color: meta?.skin_color ?? null,
        home_hidden: meta?.home_hidden ?? null,
        create_time: meta?.create_time,
      })
      result.notes++
      result.noteIds.push(id)
      if (meta?.invalid === 1) await trashNote(id)
    }

    for (const h of histories) {
      const previous = await db.history.where('note_id').equals(h.note_id).toArray()
      if (!previous.some(p => p.time === h.time && p.body === h.body)) await db.history.add(h)
    }
    for (const book of index?.knowledge_bases ?? []) {
      const existing = await db.knowledgeBases.get(book.id)
      if (existing?.deleted) continue
      const toc = await db.knowledgeBaseTocs.get(book.id)
      if (!existing) {
        await createKnowledgeBase(validateKnowledgeBaseMeta(book), book.id, book.nodes, true)
        await db.knowledgeBases.update(book.id, { create_time: book.create_time })
        result.knowledgeBases++
      } else if (JSON.stringify(validateToc(toc?.nodes ?? [])) !== JSON.stringify(validateToc(book.nodes)) || JSON.stringify(metadata(existing)) !== JSON.stringify(validateKnowledgeBaseMeta(book))) {
        // Keep the existing library; retain the imported alternative for review.
        await db.transaction('rw', knowledgeBaseTables(), async () => {
          const previous = await db.knowledgeBaseTocHistory.where('book_id').equals(book.id).toArray()
          if (!previous.some(h => h.source === 'conflict' && JSON.stringify(h.nodes) === JSON.stringify(book.nodes) && JSON.stringify(h.meta) === JSON.stringify(validateKnowledgeBaseMeta(book)))) {
            await snapshotIn(book.id, book.nodes, 'conflict', validateKnowledgeBaseMeta(book))
          }
        })
        result.knowledgeBaseConflicts++
      }
      const missing = book.nodes.flatMap(n => n.note_id ? [n.note_id] : []).filter(id => !index!.notes.some(n => n.id === id))
      for (const id of missing) if (!await db.notes.get(id)) result.missingReferences++
      await db.knowledgeBaseNoteStates.bulkPut(Object.entries(book.note_states).map(([id, state]) => ({ id, state })))
    }
    for (const h of index?.knowledge_base_histories ?? []) if (!(await db.knowledgeBases.get(h.book_id))?.deleted && !await db.knowledgeBaseTocHistory.get(h.id)) await db.knowledgeBaseTocHistory.add(h)
  })
  emitLocalWrite()

  report({ done: staged.length, total: staged.length, label: '正在刷新列表' })
  await useNotesStore().load()
  await groups.load()

  return result
}

/** 把正文里的 `../images/x.jpg` 换成上传后的正式地址；同一张图只上传一次。 */
async function replaceImageRefs(
  body: string,
  noteId: string,
  imageBytes: Map<string, Uint8Array>,
  uploaded: Map<string, string>,
  result: ImportResult,
  report: ProgressReporter
): Promise<string> {
  const refs = [...body.matchAll(RELATIVE_IMAGE_RE)]
  if (refs.length === 0) return body

  const replacements = new Map<string, string>()
  for (const match of refs) {
    const whole = match[0]
    const name = match[1]
    if (!imageBytes.has(`${IMAGES_DIR}/${name}`)) throw new Error(`备份缺少图片 ${name}，未写入笔记，请补全后重试`)

    const uploadKey = `${noteId}:${name}`
    if (!uploaded.has(uploadKey)) {
      const mime = mimeOfFile(name)
      if (!mime) throw new Error(`备份图片格式不支持：${name}`)
      const bytes = new Uint8Array(imageBytes.get(`${IMAGES_DIR}/${name}`)!)
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
      const receiptKey = `import_image:${noteId}:${digest}:${mime}`
      const receipt = await db.meta.get(receiptKey)
      if (typeof receipt?.value === 'string') {
        uploaded.set(uploadKey, receipt.value)
        replacements.set(whole, receipt.value)
        continue
      }
      report({ done: 0, total: 0, label: '正在上传图片' })
      try {
        const file = new File([bytes], name, { type: mime })
        const { url } = await uploadImage(file, noteId)
        // A failed local import can reuse already-uploaded immutable objects.
        // This receipt contains no note text and is independent of its commit.
        await db.meta.put({ key: receiptKey, value: url })
        uploaded.set(uploadKey, url)
        result.images++
      } catch {
        throw new Error(`图片 ${name} 上传失败，未写入笔记，请重试导入`)
      }
    }
    replacements.set(whole, uploaded.get(uploadKey)!)
  }

  return body.replace(RELATIVE_IMAGE_RE, (whole: string) => replacements.get(whole) ?? whole)
}
