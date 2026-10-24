import { strToU8, unzipSync, zipSync } from 'fflate'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { IMAGE_URL_PREFIX } from '../../shared/derive'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { safeName, mimeOfFile, importBackup, buildBackup } from './backup'
import { addKnowledgeBaseNode, createKnowledgeBase, updateKnowledgeBase } from '../db/knowledge-base-repo'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
  apiBlob: vi.fn(),
}))
vi.mock('../editor/image-upload', () => ({
  uploadImage: vi.fn(),
}))

const { apiFetch, apiBlob } = await import('../api/client')
const { uploadImage } = await import('../editor/image-upload')

const apiFetchMock = vi.mocked(apiFetch)
const apiBlobMock = vi.mocked(apiBlob)
const uploadMock = vi.mocked(uploadImage)

/** 读回 zip 里的条目，省得每个用例都写一遍解包 */
async function unzip(blob: Blob): Promise<Record<string, string>> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  return Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, new TextDecoder().decode(data)]))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  vi.clearAllMocks()
  apiFetchMock.mockResolvedValue({ bodies: [] })
})

describe('safeName', () => {
  it('Windows 设备保留名使用可导出的普通文件名', () => {
    expect(safeName('CON')).toBe('_CON')
    expect(safeName('LPT1.txt')).toBe('_LPT1.txt')
    expect(safeName('console')).toBe('console')
  })
  it('去掉路径分隔符与 Windows 禁用字符，保留中文', () => {
    expect(safeName('工作/汇报:2024?')).toBe('工作_汇报_2024_')
    expect(safeName('周报 <最终>')).toBe('周报 _最终_')
  })

  it('去掉首尾的点和空格——某些系统存不下也看不见这样的文件', () => {
    expect(safeName('  ..会议记录..  ')).toBe('会议记录')
  })

  it('空名字给兜底值，过长的截到 60 字', () => {
    expect(safeName('   ')).toBe('无标题')
    expect(safeName('好'.repeat(80))).toHaveLength(60)
  })
})

describe('mimeOfFile', () => {
  it('按扩展名给出 MIME，认不出来时返回 null', () => {
    expect(mimeOfFile('a.JPG')).toBe('image/jpeg')
    expect(mimeOfFile('a.webp')).toBe('image/webp')
    expect(mimeOfFile('a.txt')).toBeNull()
  })
})

describe('导出', () => {
  it('format 3 round-trips trash and historical images, and imports history idempotently', async () => {
    const note = await createNote('# 当前正文')
    const { trashNote } = await import('../db/repo')
    await trashNote(note.id)
    await db.history.add({ note_id: note.id, time: 5, body: '旧正文 ![图](/api/images/old/image.png)' })
    apiBlobMock.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]))
    uploadMock.mockResolvedValue({ url: '/api/images/new/image.png', file_key: 'new/image.png' })
    const bundle = await buildBackup()
    const files = await unzip(bundle.blob)
    expect(files['history/0.txt']).toContain('../images/image.png')
    const file = new File([bundle.blob], 'backup.zip')
    await db.delete(); await db.open()
    await importBackup([file])
    await importBackup([file])
    expect((await db.notes.get(note.id))?.invalid).toBe(1)
    expect(await db.history.count()).toBe(1)
    expect((await db.history.toArray())[0].body).toContain('/api/images/new/image.png')
  })
  it('每个分组一个文件夹、每条笔记一个 .md，index.json 记录属性', async () => {
    const groups = useGroupsStore()
    const work = await groups.create('工作')

    await createNote('# 会议记录\n\n正文', { group_id: work.group_id, star: 1, top: 1, skin_color: '#cb8585', create_time: 1234 })
    await createNote('# 随手记')

    const { blob, notes, groups: groupCount } = await buildBackup()
    const files = await unzip(blob)

    expect(notes).toBe(2)
    expect(groupCount).toBe(1)
    expect(Object.keys(files)).toContain('工作/会议记录.md')
    expect(Object.keys(files)).toContain('未分组/随手记.md')
    expect(files['工作/会议记录.md']).toBe('# 会议记录\n\n正文')

    const index = JSON.parse(files['index.json'])
    expect(index.app).toBe('snotes')
    expect(index.groups).toHaveLength(1)
    expect(index.groups[0]).toMatchObject({ name: '工作', color: null })
    const meeting = index.notes.find((n: { title: string }) => n.title === '会议记录')
    expect(meeting).toMatchObject({ group_id: work.group_id, star: 1, top: 1, skin_color: '#cb8585', create_time: 1234, file: '工作/会议记录.md' })
  })

  it('重名笔记按序号区分，不会互相覆盖', async () => {
    await createNote('# 周报')
    await createNote('# 周报')

    const files = await unzip((await buildBackup()).blob)
    expect(Object.keys(files).filter((p) => p.endsWith('.md'))).toEqual(['未分组/周报.md', '未分组/周报-2.md'])
  })

  it('默认备份保留未被笔记本引用的回收站笔记', async () => {
    const note = await createNote('# 要删的')
    const { trashNote } = await import('../db/repo')
    await trashNote(note.id)

    const files = await unzip((await buildBackup()).blob)
    const index = JSON.parse(files['index.json'])
    expect(index.notes).toHaveLength(1)
    expect(index.notes[0].invalid).toBe(1)
    expect(files[index.notes[0].file]).toBe('# 要删的')
  })

  it('图片下载后放进 images/，正文引用改成相对路径', async () => {
    apiBlobMock.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]))
    await createNote('# 带图\n\n![照片](/api/images/n1/abc.jpg)')

    const bundle = await buildBackup()
    const files = await unzip(bundle.blob)

    expect(bundle.images).toBe(1)
    expect(apiBlobMock).toHaveBeenCalledWith(`${IMAGE_URL_PREFIX}n1/abc.jpg`)
    expect(files['未分组/带图.md']).toBe('# 带图\n\n![照片](../images/abc.jpg)')
    expect(Object.keys(files)).toContain('images/abc.jpg')
  })

  it('图片下载失败时保留原地址并如实计数，不假装导出完整', async () => {
    apiBlobMock.mockRejectedValue(new Error('offline'))
    await createNote('# 带图\n\n![照片](/api/images/n1/abc.jpg)')

    const bundle = await buildBackup()
    const files = await unzip(bundle.blob)

    expect(bundle.missingImages).toBe(1)
    expect(bundle.images).toBe(0)
    expect(files['未分组/带图.md']).toContain('/api/images/n1/abc.jpg')
  })

  it('本地没有正文的笔记先按 id 拉一次正文再打包', async () => {
    await db.notes.add({
      id: 'remote', group_id: null, title: '远端的', summary: '', thumbnail: null,
      version: 3, prop_version: 3, star: 0, top: 0, skin_color: null, invalid: 0,
      create_time: 5, update_time: 6, body_version: 0, dirty: 'none',
      open_count: 0, last_open_time: 0,
    })
    apiFetchMock.mockResolvedValue({ bodies: [{ note_id: 'remote', content: '# 远端的\n\n拉下来的正文', version: 3 }] })

    const files = await unzip((await buildBackup()).blob)

    expect(apiFetchMock).toHaveBeenCalledWith('/api/sync/bodies', expect.objectContaining({ method: 'POST' }))
    expect(files['未分组/远端的.md']).toBe('# 远端的\n\n拉下来的正文')
  })

  it('拉正文失败时整次导出报错，而不是导出空笔记', async () => {
    await db.notes.add({
      id: 'remote', group_id: null, title: '远端的', summary: '', thumbnail: null,
      version: 3, prop_version: 3, star: 0, top: 0, skin_color: null, invalid: 0,
      create_time: 5, update_time: 6, body_version: 0, dirty: 'none',
      open_count: 0, last_open_time: 0,
    })
    apiFetchMock.mockRejectedValue(new Error('offline'))

    await expect(buildBackup()).rejects.toThrow('offline')
  })
})

it('导入只替换相对图片路径，不破坏同名外部图片地址', async () => {
  uploadMock.mockResolvedValue({ file_key: 'new/image.jpg', url: '/api/images/new/image.jpg' })
  const external = '![external](https://cdn.example/images/abc.jpg)'
  const bytes = zipSync({ 'note.md': strToU8(`${external}\n![local](../images/abc.jpg)`), 'images/abc.jpg': new Uint8Array([1, 2, 3]) })
  await importBackup([new File([new Uint8Array(bytes)], 'images.zip')])
  const note = (await db.notes.toArray())[0]!
  const body = (await db.bodies.get(note.id))!.body
  expect(body).toContain(external)
  expect(body).toContain('![local](/api/images/new/image.jpg)')
  expect(uploadMock).toHaveBeenCalledTimes(1)
})

it('两篇笔记引用同一包内图片时，各自上传到自己的 owner', async () => {
  uploadMock.mockImplementation(async (_file, noteId) => ({ file_key: `${noteId}/photo.jpg`, url: `/api/images/${noteId}/photo.jpg` }))
  const bytes = zipSync({
    'a.md': strToU8('# A\n\n![](../images/photo.jpg)'),
    'b.md': strToU8('# B\n\n![](../images/photo.jpg)'),
    'images/photo.jpg': new Uint8Array([1, 2, 3]),
  })
  await importBackup([new File([new Uint8Array(bytes)], 'shared-image.zip')])
  const notes = await db.notes.toArray()
  expect(notes).toHaveLength(2)
  expect(uploadMock).toHaveBeenCalledTimes(2)
  for (const note of notes) expect((await db.bodies.get(note.id))!.body).toContain(`/api/images/${note.id}/photo.jpg`)
})

it('导入预检查拒绝超限正文，尚未创建任何分组或笔记', async () => {
  const bytes = zipSync({ 'group/a.md': strToU8('# A'), 'group/b.md': strToU8('中'.repeat(350_000)) })
  await expect(importBackup([new File([new Uint8Array(bytes)], 'oversized.zip')])).rejects.toThrow('1 MiB')
  expect(await db.notes.count()).toBe(0)
  expect(await db.groups.count()).toBe(0)
  expect(uploadMock).not.toHaveBeenCalled()
})

it('导出不把外部绝对图片 URL 的路径误当作本站图片', async () => {
  const external = '![external](https://other.example/api/images/n/abc.jpg)'
  await createNote(`${external}\n![local](/api/images/n/abc.jpg)`)
  apiBlobMock.mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }))
  const files = await unzip((await buildBackup()).blob)
  const body = Object.entries(files).find(([path]) => path.endsWith('.md'))![1]
  expect(body).toContain(external)
  expect(body).toContain('![local](../images/abc.jpg)')
  expect(apiBlobMock).toHaveBeenCalledTimes(1)
})

describe('导入', () => {
  it('a failure after the first note rolls back notes, groups and sync tasks together', async () => {
    const files = [new File(['# 一'], 'one.md'), new File(['# 二'], 'two.md')]
    await expect(importBackup(files, progress => {
      if (progress.label === '正在导入笔记' && progress.done === 1) throw new Error('simulated interruption')
    })).rejects.toThrow('simulated interruption')
    expect(await db.notes.count()).toBe(0)
    expect(await db.groups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect((await importBackup(files)).notes).toBe(2)
  })
  it('different content with the same id is retained in history without overwriting or duplicate snapshots', async () => {
    const note = await createNote('# 导入版本')
    const bundle = await buildBackup()
    const { updateBody } = await import('../db/repo')
    await updateBody(note.id, '# 现有版本')
    const file = new File([new Uint8Array(await bundle.blob.arrayBuffer())], 'backup.zip')
    const result = await importBackup([file])
    expect(result.noteConflicts).toBe(1)
    expect((await db.bodies.get(note.id))?.body).toBe('# 现有版本')
    await importBackup([file])
    expect((await db.history.where('note_id').equals(note.id).toArray()).filter(row => row.body === '# 导入版本')).toHaveLength(1)
  })
  it('reimporting indexed images reuses upload receipts and does not manufacture a body conflict', async () => {
    const index = { app: 'snotes', format: 1, exported_at: 1, groups: [], notes: [{ id: 'same-image', group_id: null, title: '图片', star: 0, top: 0, skin_color: null, create_time: 1, update_time: 1, file: 'a.md' }] }
    const zip = zipSync({ 'index.json': strToU8(JSON.stringify(index)), 'a.md': strToU8('![](images/a.png)'), 'images/a.png': new Uint8Array([1, 2]) })
    uploadMock.mockResolvedValue({ file_key: 'same-image/photo.png', url: '/api/images/same-image/photo.png' })
    const file = new File([new Uint8Array(zip)], 'b.zip')
    await importBackup([file])
    const result = await importBackup([file])
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ skipped: 1, noteConflicts: 0 })
  })
  it('完整备份往返保留跨库同一笔记引用，重复导入不翻倍', async () => {
    const note = await createNote('# 同一篇笔记')
    const meta = { name: '笔记本', description: '简介', icon: '📚', ord: 0, invalid: 0 as const }
    const a = await createKnowledgeBase(meta)
    const b = await createKnowledgeBase({ ...meta, name: '第二个库' })
    await addKnowledgeBaseNode(a.id, { kind: 'note', note_id: note.id, title: null })
    // Simulate a legacy shared reference; new joins now enforce single ownership.
    await db.knowledgeBaseTocs.update(b.id, { nodes: [{ id: 'legacy-shared', kind: 'note', note_id: note.id, title: null, parent_id: null, ord: 0 }] })
    const bundle = await buildBackup()
    const files = await unzip(bundle.blob)
    const index = JSON.parse(files['index.json'])
    expect(index.format).toBe(3)
    expect(index.notes).toHaveLength(1)
    expect(index.knowledge_bases).toHaveLength(2)
    const bytes = new Uint8Array(await bundle.blob.arrayBuffer())
    await db.delete(); await db.open(); setActivePinia(createPinia())
    const makeFile = () => new File([bytes], 'backup.zip')
    const first = await importBackup([makeFile()])
    expect(first).toMatchObject({ notes: 1, knowledgeBases: 2, knowledgeBaseConflicts: 0 })
    const again = await importBackup([makeFile()])
    expect(again).toMatchObject({ notes: 0, skipped: 1, knowledgeBases: 0, knowledgeBaseConflicts: 0 })
    expect(await db.notes.count()).toBe(1)
    expect((await db.knowledgeBaseTocs.toArray()).flatMap(t => t.nodes.map(n => n.note_id))).toEqual([note.id, note.id])
  })

  it('同 ID 的笔记本不同内容不会被导入覆盖，替代内容保存为快照', async () => {
    const meta = { name: '原名称', description: '', icon: '', ord: 0, invalid: 0 as const }
    const book = await createKnowledgeBase(meta)
    const bundle = await buildBackup()
    await updateKnowledgeBase(book.id, { name: '现在的名称' })
    const result = await importBackup([new File([new Uint8Array(await bundle.blob.arrayBuffer())], 'backup.zip')])
    expect(result.knowledgeBaseConflicts).toBe(1)
    expect((await db.knowledgeBases.get(book.id))?.name).toBe('现在的名称')
    expect((await db.knowledgeBaseTocHistory.toArray())[0].meta?.name).toBe('原名称')
  })

  it('格式 2 保留回收站引用与已移除笔记本；旧版导出明确不含笔记本', async () => {
    const note = await createNote('# 回收站笔记')
    const book = await createKnowledgeBase({ name: '资料', description: '', icon: '', ord: 0, invalid: 0 })
    await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })
    const { trashNote } = await import('../db/repo')
    await trashNote(note.id)
    await updateKnowledgeBase(book.id, { invalid: 1 })
    const full = await buildBackup()
    const legacy = JSON.parse((await unzip((await buildBackup(undefined, 1)).blob))['index.json'])
    expect(legacy.format).toBe(1)
    expect(legacy.knowledge_bases).toBeUndefined()
    expect(legacy.notes).toHaveLength(0)
    await db.delete(); await db.open(); setActivePinia(createPinia())
    await importBackup([new File([new Uint8Array(await full.blob.arrayBuffer())], 'backup.zip')])
    expect((await db.notes.get(note.id))?.invalid).toBe(1)
    expect((await db.knowledgeBases.get(book.id))?.invalid).toBe(1)
  })

  it('未知格式或损坏目录在写入任何笔记前拒绝', async () => {
    const index = { app: 'snotes', format: 99, exported_at: 1, notes: [], groups: [] }
    const zip = zipSync({ 'index.json': strToU8(JSON.stringify(index)) })
    await expect(importBackup([new File([new Uint8Array(zip)], 'b.zip')])).rejects.toThrow('不支持')
    expect(await db.notes.count()).toBe(0)
  })
  it.each(['duplicate-id', 'duplicate-file', 'invalid-time', 'invalid-props', 'missing-group', 'wrong-extension'])('拒绝损坏索引 %s，上传与本地写入均不开始', async kind => {
    const note = { id: 'a', group_id: null as string | null, title: 'A', star: 0, top: 0, skin_color: null, create_time: 1, update_time: 1, file: 'a.md' }
    const notes = [note]
    if (kind === 'duplicate-id') notes.push({ ...note, file: 'b.md' })
    if (kind === 'duplicate-file') notes.push({ ...note, id: 'b' })
    if (kind === 'invalid-time') note.create_time = 9_000_000_000_000_000
    if (kind === 'invalid-props') note.star = 3
    if (kind === 'missing-group') note.group_id = 'missing'
    if (kind === 'wrong-extension') note.file = 'a.txt'
    const index = { app: 'snotes', format: 1, exported_at: 1, groups: [], notes }
    const zip = zipSync({ 'index.json': strToU8(JSON.stringify(index)), 'a.md': strToU8('![](images/a.png)'), 'b.md': strToU8('B'), 'a.txt': strToU8('A') })
    await expect(importBackup([new File([new Uint8Array(zip)], 'backup.zip')])).rejects.toThrow('索引')
    expect(await db.notes.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(uploadMock).not.toHaveBeenCalled()
  })
  const mdFile = (name: string, text: string) => new File([text], name, { type: 'text/markdown' })

  it('导入散装 .md：建笔记、按标题派生标题', async () => {
    const result = await importBackup([mdFile('会议.md', '# 会议记录\n\n讨论内容')])

    expect(result.notes).toBe(1)
    const note = (await db.notes.toArray())[0]
    expect(result.noteIds).toEqual([note.id])
    expect(note.title).toBe('会议记录')
    expect((await db.bodies.get(note.id))!.body).toBe('# 会议记录\n\n讨论内容')
    // 走的是 createNote，所以照样进了同步队列
    expect(await db.outbox.where('kind').equals('create').count()).toBe(1)
  })

  it('带 index.json 的包还原分组、星标、置顶、颜色与创建时间', async () => {
    const index = {
      app: 'snotes',
      format: 1,
      exported_at: 1,
      groups: [{ group_id: 'g-old', name: '工作', ord: 0, color: '#86a394', update_time: 1 }],
      notes: [{
        id: 'note-old', group_id: 'g-old', title: '会议', star: 1, top: 1, skin_color: '#cb8585',
        create_time: 1234, update_time: 1234, file: '工作/会议.md',
      }],
    }
    const zip = zipSync({
      'index.json': strToU8(JSON.stringify(index)),
      '工作/会议.md': strToU8('# 会议\n\n正文'),
    })

    const result = await importBackup([new File([new Uint8Array(zip)], 'backup.zip', { type: 'application/zip' })])

    expect(result).toMatchObject({ notes: 1, groups: 1 })
    const note = (await db.notes.get('note-old'))!
    expect(note).toMatchObject({ star: 1, top: 1, skin_color: '#cb8585', create_time: 1234 })
    expect((await db.bodies.get('note-old'))!.body).toBe('# 会议\n\n正文')
    const group = (await db.groups.toArray())[0]
    expect(group).toMatchObject({ name: '工作', color: '#86a394' })

    // 再导一次同一个包：分组按名字复用，不会多出第二个「工作」
    const again = await importBackup([new File([new Uint8Array(zip)], 'backup.zip', { type: 'application/zip' })])
    expect(again).toMatchObject({ notes: 0, skipped: 1, groups: 0 })
    expect((await db.groups.toArray()).filter((g) => g.name === '工作')).toHaveLength(1)
    // 分组 id 是新建的，笔记要落在新 id 上
    expect(note.group_id).toBe(group.group_id)
  })

  it('没有 index.json 时按文件夹名建分组，未分组文件夹不建组', async () => {
    const zip = zipSync({
      '读书/读后感.md': strToU8('# 读后感\n\n好书'),
      '未分组/随手.md': strToU8('# 随手\n\n一笔'),
    })

    await importBackup([new File([new Uint8Array(zip)], 'b.zip')])

    const groups = await db.groups.toArray()
    expect(groups.map((g) => g.name)).toEqual(['读书'])
    const note = (await db.notes.toArray()).find((n) => n.title === '随手')!
    expect(note.group_id).toBeNull()
  })

  it('重复导入同一份包不会产生副本', async () => {
    const index = { app: 'snotes', format: 1, exported_at: 1, groups: [], notes: [{ id: 'n1', group_id: null, title: 'A', star: 0, top: 0, skin_color: null, create_time: 1, update_time: 1, file: '未分组/A.md' }] }
    const zip = zipSync({ 'index.json': strToU8(JSON.stringify(index)), '未分组/A.md': strToU8('# A') })
    const file = () => new File([new Uint8Array(zip)], 'b.zip')

    await importBackup([file()])
    const second = await importBackup([file()])

    expect(second).toMatchObject({ notes: 0, skipped: 1 })
    expect(await db.notes.count()).toBe(1)
  })

  it('图片重新上传并把相对路径换成正式地址', async () => {
    uploadMock.mockResolvedValue({ file_key: 'n/xyz.jpg', url: '/api/images/n/xyz.jpg' })
    const zip = zipSync({
      '未分组/带图.md': strToU8('# 带图\n\n![照片](../images/abc.jpg)'),
      'images/abc.jpg': new Uint8Array([1, 2, 3]),
    })

    const result = await importBackup([new File([new Uint8Array(zip)], 'b.zip')])

    expect(result.images).toBe(1)
    expect(uploadMock).toHaveBeenCalledTimes(1)
    const note = (await db.notes.toArray())[0]
    expect((await db.bodies.get(note.id))!.body).toBe('# 带图\n\n![照片](/api/images/n/xyz.jpg)')
  })

  it('图片上传失败时不提交任何笔记或分组，可以完整重试', async () => {
    uploadMock.mockRejectedValue(new Error('offline'))
    const zip = zipSync({
      '未分组/带图.md': strToU8('# 带图\n\n![照片](../images/abc.jpg)'),
      'images/abc.jpg': new Uint8Array([1, 2, 3]),
    })

    await expect(importBackup([new File([new Uint8Array(zip)], 'b.zip')])).rejects.toThrow('上传失败')
    expect(await db.notes.count()).toBe(0)
    expect(await db.groups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('导入后列表立刻能看到新笔记', async () => {
    await importBackup([mdFile('a.md', '# 甲')])

    const notes = useNotesStore()
    expect(notes.notes.map((n) => n.title)).toContain('甲')
  })
})
