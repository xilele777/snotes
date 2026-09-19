import { strToU8, unzipSync, zipSync } from 'fflate'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { IMAGE_URL_PREFIX } from '../../shared/derive'
import { useGroupsStore } from '../stores/groups'
import { useNotesStore } from '../stores/notes'
import { safeName, mimeOfFile, importBackup, buildBackup } from './backup'

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

  it('回收站里的笔记不进备份包', async () => {
    const note = await createNote('# 要删的')
    const { trashNote } = await import('../db/repo')
    await trashNote(note.id)

    const files = await unzip((await buildBackup()).blob)
    expect(Object.keys(files)).toEqual(['index.json'])
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
      create_time: 5, update_time: 6, body: '', body_version: 0, dirty: 'none',
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
      create_time: 5, update_time: 6, body: '', body_version: 0, dirty: 'none',
      open_count: 0, last_open_time: 0,
    })
    apiFetchMock.mockRejectedValue(new Error('offline'))

    await expect(buildBackup()).rejects.toThrow('offline')
  })
})

describe('导入', () => {
  const mdFile = (name: string, text: string) => new File([text], name, { type: 'text/markdown' })

  it('导入散装 .md：建笔记、按标题派生标题', async () => {
    const result = await importBackup([mdFile('会议.md', '# 会议记录\n\n讨论内容')])

    expect(result.notes).toBe(1)
    const note = (await db.notes.toArray())[0]
    expect(note.title).toBe('会议记录')
    expect(note.body).toBe('# 会议记录\n\n讨论内容')
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
    expect(note).toMatchObject({ star: 1, top: 1, skin_color: '#cb8585', create_time: 1234, body: '# 会议\n\n正文' })
    const group = (await db.groups.toArray())[0]
    expect(group).toMatchObject({ name: '工作', color: '#86a394' })
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
    expect(note.body).toBe('# 带图\n\n![照片](/api/images/n/xyz.jpg)')
  })

  it('图片上传失败时保留相对路径并计数，笔记照样导入', async () => {
    uploadMock.mockRejectedValue(new Error('offline'))
    const zip = zipSync({
      '未分组/带图.md': strToU8('# 带图\n\n![照片](../images/abc.jpg)'),
      'images/abc.jpg': new Uint8Array([1, 2, 3]),
    })

    const result = await importBackup([new File([new Uint8Array(zip)], 'b.zip')])

    expect(result).toMatchObject({ notes: 1, images: 0, failedImages: 1 })
    expect((await db.notes.toArray())[0].body).toContain('../images/abc.jpg')
  })

  it('导入后列表立刻能看到新笔记', async () => {
    await importBackup([mdFile('a.md', '# 甲')])

    const notes = useNotesStore()
    expect(notes.notes.map((n) => n.title)).toContain('甲')
  })
})
