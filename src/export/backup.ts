import { IMAGE_URL_PREFIX } from '../../shared/derive'
import type { LocalNote, NoteBody } from '../../shared/types'
import type { Zippable } from 'fflate'
import { apiBlob, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { uploadImage } from '../editor/image-upload'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'

/** 备份包的格式版本；将来结构有不兼容变化时靠它决定怎么读。 */
export const BACKUP_FORMAT = 1
export const INDEX_FILE = 'index.json'
export const IMAGES_DIR = 'images'
/** 未分组笔记在包内的文件夹名。 */
export const UNGROUPED_DIR = '未分组'

/** 正文里指向本站图片的引用，file_key 形如 `<noteId>/<uuid>.jpg`。 */
const IMAGE_REF_RE = /\/api\/images\/([^\s)"'<>\]]+)/g
/** 导入时认的图片相对引用：`images/x.jpg` 或 `../images/x.jpg`。 */
const RELATIVE_IMAGE_RE = /(?:\.\.\/)?images\/([^\s)"'<>\]]+)/g

export interface BackupGroup {
  group_id: string
  name: string
  ord: number
  color: string | null
  update_time: number
}

export interface BackupNote {
  id: string
  group_id: string | null
  title: string
  star: 0 | 1
  top: 0 | 1
  skin_color: string | null
  create_time: number
  update_time: number
  /** 笔记在包内的路径，导入时按它把 index.json 和正文对上 */
  file: string
}

export interface BackupIndex {
  app: 'snotes'
  format: number
  exported_at: number
  groups: BackupGroup[]
  notes: BackupNote[]
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
  return cut || fallback
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
  const missing = notes.filter((n) => n.body_version === 0).map((n) => n.id)
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
  }
}

export interface BackupBundle {
  blob: Blob
  notes: number
  groups: number
  images: number
  /** 有图片没能下载下来时给出数量，界面上要如实告诉用户 */
  missingImages: number
}

/**
 * 导出全部笔记为 zip：每个分组一个文件夹、每条笔记一个 .md，
 * 图片下载后放进 images/ 并把正文里的引用改写成相对路径。
 * zip 库按需加载，不进首屏。
 */
export async function buildBackup(report: ProgressReporter = () => {}): Promise<BackupBundle> {
  const { strToU8, zipSync } = await import('fflate')

  const all = (await db.notes.toArray()).filter((n) => n.invalid === 0)
  const groups = (await db.groups.toArray()).filter((g) => g.invalid === 0).sort((a, b) => a.ord - b.ord)

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
    format: BACKUP_FORMAT,
    exported_at: Date.now(),
    groups: groups.map((g) => ({
      group_id: g.group_id,
      name: g.name,
      ord: g.ord,
      color: g.color,
      update_time: g.update_time,
    })),
    notes: [],
  }

  // 先扫一遍所有正文，把图片引用收齐——同一张图可能被多条笔记引用，只下载一次。
  const imageKeys: string[] = []
  const seenKeys = new Set<string>()
  for (const note of sorted) {
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
      group_id: note.group_id,
      title: note.title,
      star: note.star,
      top: note.top,
      skin_color: note.skin_color,
      create_time: note.create_time,
      update_time: note.update_time,
      file: path,
    })
    report({ done: i + 1, total: sorted.length, label: '正在写入笔记' })
  })

  files[INDEX_FILE] = strToU8(JSON.stringify(index, null, 2))

  const zipped = zipSync(files)
  return {
    blob: new Blob([new Uint8Array(zipped)], { type: 'application/zip' }),
    notes: sorted.length,
    groups: groups.length,
    images: imagePaths.size,
    missingImages,
  }
}

export interface ImportResult {
  notes: number
  /** 已经存在（id 相同）而跳过的条数，重复导入同一份包不会产生副本 */
  skipped: number
  groups: number
  images: number
  failedImages: number
}

interface StagedNote {
  path: string
  body: string
  meta?: BackupNote
}

/** 从 zip 里读出 index.json；没有或者是别的格式就返回 null。 */
function readIndex(entries: Record<string, Uint8Array>, strFromU8: (d: Uint8Array) => string): BackupIndex | null {
  const raw = entries[INDEX_FILE]
  if (!raw) return null
  try {
    const parsed = JSON.parse(strFromU8(raw)) as BackupIndex
    if (parsed?.app !== 'snotes' || !Array.isArray(parsed.notes)) return null
    return parsed
  } catch {
    return null
  }
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
  const { strFromU8, unzipSync } = await import('fflate')
  const result: ImportResult = { notes: 0, skipped: 0, groups: 0, images: 0, failedImages: 0 }

  const staged: StagedNote[] = []
  /** 包内路径 → 图片字节，导入时按需上传 */
  const imageBytes = new Map<string, Uint8Array>()
  let index: BackupIndex | null = null

  for (const file of picked) {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip'
    if (!isZip) {
      const raw = safeName(file.name.replace(/\.(md|markdown|txt)$/i, ''), '无标题')
      staged.push({ path: raw, body: await file.text() })
      continue
    }

    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    index = readIndex(entries, strFromU8) ?? index
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/')) continue
      if (/\.md$/i.test(path)) {
        staged.push({ path, body: strFromU8(data) })
      } else if (path.startsWith(`${IMAGES_DIR}/`)) {
        imageBytes.set(path, data)
      }
    }
  }

  const metaByFile = new Map((index?.notes ?? []).map((n) => [n.file, n]))
  const groups = useGroupsStore()

  // 分组：index.json 里有记录的分组先建好，剩下的按文件夹名现建。
  const groupIdByOldId = new Map<string, string>()
  if (index) {
    for (const g of index.groups) {
      const created = await groups.create(g.name, { color: g.color })
      groupIdByOldId.set(g.group_id, created.group_id)
      result.groups++
    }
  }

  const groupIdByName = new Map<string, string>()
  for (const g of groups.groups) groupIdByName.set(g.name, g.group_id)

  const urlByImagePath = new Map<string, string>()
  const total = staged.length

  for (let i = 0; i < total; i++) {
    const item = staged[i]
    report({ done: i, total, label: '正在导入笔记' })

    const meta = metaByFile.get(item.path)
    const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''

    let groupId: string | null = null
    if (meta?.group_id) {
      groupId = groupIdByOldId.get(meta.group_id) ?? null
    } else if (dir && dir !== UNGROUPED_DIR) {
      const name = safeName(dir, UNGROUPED_DIR)
      if (!groupIdByName.has(name)) {
        const created = await groups.create(name)
        groupIdByName.set(name, created.group_id)
        result.groups++
      }
      groupId = groupIdByName.get(name) ?? null
    }

    // 已经导入过（或本来就是本机的笔记）就跳过，重复导入不会翻倍。
    if (meta && (await db.notes.get(meta.id))) {
      result.skipped++
      continue
    }
    const id = meta?.id ?? crypto.randomUUID()

    const body = await replaceImageRefs(item.body, id, imageBytes, urlByImagePath, result, report)
    await createNote(body, {
      id,
      group_id: groupId,
      star: meta?.star ?? 0,
      top: meta?.top ?? 0,
      skin_color: meta?.skin_color ?? null,
      create_time: meta?.create_time,
    })
    result.notes++
  }

  report({ done: total, total, label: '正在刷新列表' })
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
    if (!imageBytes.has(`${IMAGES_DIR}/${name}`)) continue

    if (!uploaded.has(name)) {
      const mime = mimeOfFile(name)
      if (!mime) continue
      report({ done: 0, total: 0, label: '正在上传图片' })
      try {
        const bytes = new Uint8Array(imageBytes.get(`${IMAGES_DIR}/${name}`)!)
        const file = new File([bytes], name, { type: mime })
        const { url } = await uploadImage(file, noteId)
        uploaded.set(name, url)
        result.images++
      } catch {
        result.failedImages++
        continue
      }
    }
    replacements.set(whole, uploaded.get(name)!)
  }

  return body.replace(RELATIVE_IMAGE_RE, (whole: string) => replacements.get(whole) ?? whole)
}
