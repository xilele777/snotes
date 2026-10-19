/** 留出 D1 单行限制的余量；按 UTF-8 字节计，不按 JS 字符数计。 */
export const MAX_NOTE_BYTES = 1024 * 1024
export function noteFits(content: string): boolean {
  return content.length <= MAX_NOTE_BYTES && new TextEncoder().encode(content).byteLength <= MAX_NOTE_BYTES
}
