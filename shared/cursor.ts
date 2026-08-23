const SEP = ':'

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromUrlSafe(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4)
}

export function encodeCursor(update_time: number, id: string): string {
  return toUrlSafe(btoa(`${update_time}${SEP}${id}`))
}

export function decodeCursor(cursor: string): { update_time: number; id: string } | null {
  if (!cursor) return null

  try {
    const raw = atob(fromUrlSafe(cursor))
    const idx = raw.indexOf(SEP)
    if (idx <= 0) return null

    const update_time = Number(raw.slice(0, idx))
    const id = raw.slice(idx + 1)
    if (!Number.isFinite(update_time) || !id) return null

    return { update_time, id }
  } catch {
    return null
  }
}
