-- Keep timestamp-based cursors compatible, but assign timestamps at commit in
-- the database rather than before asynchronous application-side checks.
CREATE TABLE note_sync_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark INTEGER NOT NULL
);
INSERT INTO note_sync_clock (id, watermark)
SELECT 1, MAX(
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
  COALESCE((SELECT MAX(update_time) FROM note), 0),
  COALESCE((SELECT MAX(update_time) FROM note_group), 0)
);

CREATE TRIGGER note_sync_insert AFTER INSERT ON note BEGIN
  UPDATE note_sync_clock SET watermark = MAX(watermark + 1, NEW.update_time,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) WHERE id = 1;
  UPDATE note SET update_time = (SELECT watermark FROM note_sync_clock WHERE id = 1) WHERE id = NEW.id;
END;
-- Exclude update_time itself, so the trigger's timestamp assignment never
-- recursively fires. Every application mutation touches at least one field below.
CREATE TRIGGER note_sync_update AFTER UPDATE OF group_id, title, summary, thumbnail,
  version, prop_version, star, top, skin_color, home_hidden, invalid, create_time ON note BEGIN
  UPDATE note_sync_clock SET watermark = MAX(watermark + 1, NEW.update_time,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) WHERE id = 1;
  UPDATE note SET update_time = (SELECT watermark FROM note_sync_clock WHERE id = 1) WHERE id = NEW.id;
END;

CREATE TRIGGER group_sync_insert AFTER INSERT ON note_group BEGIN
  UPDATE note_sync_clock SET watermark = MAX(watermark + 1, NEW.update_time,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) WHERE id = 1;
  UPDATE note_group SET update_time = (SELECT watermark FROM note_sync_clock WHERE id = 1) WHERE group_id = NEW.group_id;
END;
CREATE TRIGGER group_sync_update AFTER UPDATE OF name, ord, color, hide_from_home, invalid ON note_group BEGIN
  UPDATE note_sync_clock SET watermark = MAX(watermark + 1, NEW.update_time,
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) WHERE id = 1;
  UPDATE note_group SET update_time = (SELECT watermark FROM note_sync_clock WHERE id = 1) WHERE group_id = NEW.group_id;
END;
