-- Random receipts disappear when restoring an older backup. They also expire
-- before tombstones, so stale devices must reconcile the complete inventory.
CREATE TABLE sync_checkpoint (
  token TEXT PRIMARY KEY,
  watermark INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sync_checkpoint_expiry ON sync_checkpoint(expires_at);
CREATE INDEX sync_checkpoint_watermark ON sync_checkpoint(watermark, expires_at);
