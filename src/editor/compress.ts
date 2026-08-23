export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.82

/**
 * 压缩到长边 ≤ MAX_EDGE。GIF 可能是动图，压缩会丢帧，因此原样返回。
 * PNG 保留透明通道，故仍以 PNG 输出；其余统一转 JPEG。
 *
 * 单独成文件是因为 createImageBitmap 与 canvas 在 jsdom 下都不存在，
 * 只有隔离出去，调用方的单测才能整体 mock 掉它。
 */
export async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

  if (scale === 1 && file.size < 512 * 1024) return file

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, JPEG_QUALITY)
  )

  return blob && blob.size < file.size ? blob : file
}
