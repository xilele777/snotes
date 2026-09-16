import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import type { ImageObject, ImageStore } from '../worker/storage'

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

export class DiskImages implements ImageStore {
  private root: string
  constructor(directory: string) { this.root = resolve(directory) }

  private path(key: string): string | null {
    const parts = key.split('/')
    if (parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..')) return null
    return join(this.root, ...parts)
  }

  async put(key: string, value: ArrayBuffer) {
    const filename = this.path(key)
    if (!filename || !MIME[extname(filename)]) throw new Error('Invalid image key')
    if (value.byteLength > 10 * 1024 * 1024) throw new Error('Image exceeds 10 MiB')
    await mkdir(dirname(filename), { recursive: true })
    const temp = `${filename}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, new Uint8Array(value), { flag: 'wx', mode: 0o600 })
      await rename(temp, filename)
    } finally {
      await rm(temp, { force: true })
    }
  }

  async get(key: string): Promise<ImageObject | null> {
    const filename = this.path(key)
    if (!filename || !MIME[extname(filename)]) return null
    try {
      const bytes = await readFile(filename)
      return {
        body: new Uint8Array(bytes).buffer,
        httpEtag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
        httpMetadata: { contentType: MIME[extname(filename)] },
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async delete(key: string) {
    const filename = this.path(key)
    if (!filename) throw new Error('Invalid image key')
    await rm(filename, { force: true })
  }
}
