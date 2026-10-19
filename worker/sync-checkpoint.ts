import type { Database } from './storage'

export const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export type SyncDomain = 'notes' | 'books'

export async function instanceEpoch(db: Database, deploymentEpoch = ''): Promise<string> {
  const row = await db.prepare('SELECT epoch FROM sync_instance WHERE id = 1').first<{ epoch: string }>()
  if (!row) throw new Error('Missing sync instance; apply database migrations')
  return `${deploymentEpoch}:${row.epoch}`
}

export async function validCheckpoint(db: Database, token: unknown, since: number, domain: SyncDomain = 'notes', deploymentEpoch = '', requireCurrent = false): Promise<boolean> {
  if (typeof token !== 'string' || token.length > 100) return false
  const clock = domain === 'notes' ? '(SELECT watermark FROM note_sync_clock WHERE id = 1)' : '(SELECT seq FROM knowledge_base_clock WHERE id = 1)'
  return !!await db.prepare(`SELECT token FROM sync_checkpoint WHERE token = ? AND watermark = ? AND expires_at > ?
    AND domain = ? AND epoch = ? AND watermark <= ${clock}
    AND (? = 0 OR watermark = ${clock})
    AND (watermark < ${clock} OR revision = (SELECT revision FROM sync_revision WHERE domain = ?))`)
    .bind(token, since, Date.now(), domain, await instanceEpoch(db, deploymentEpoch), requireCurrent ? 1 : 0, domain).first()
}

export async function issueCheckpoint(db: Database, watermark: number, domain: SyncDomain = 'notes', deploymentEpoch = ''): Promise<string> {
  const epoch = await instanceEpoch(db, deploymentEpoch)
  // Idle polls and pagination at the same watermark share a receipt. Without
  // reuse a single always-open client would create thousands of rows per day.
  const existing = await db.prepare('SELECT token FROM sync_checkpoint WHERE watermark = ? AND domain = ? AND epoch = ? AND revision = (SELECT revision FROM sync_revision WHERE domain = ?) AND expires_at > ? LIMIT 1')
    .bind(watermark, domain, epoch, domain, Date.now() + CHECKPOINT_TTL_MS / 2).first<{ token: string }>()
  if (existing) return existing.token
  const token = crypto.randomUUID()
  await db.batch([
    db.prepare('DELETE FROM sync_checkpoint WHERE expires_at <= ?').bind(Date.now()),
    db.prepare('INSERT INTO sync_checkpoint (token, watermark, expires_at, domain, epoch, revision) SELECT ?, ?, ?, ?, ?, revision FROM sync_revision WHERE domain = ?')
      .bind(token, watermark, Date.now() + CHECKPOINT_TTL_MS, domain, epoch, domain),
  ])
  return token
}
