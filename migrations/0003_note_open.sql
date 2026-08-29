CREATE TABLE note_open (
  note_id        TEXT    NOT NULL,
  device_id      TEXT    NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  last_open_time INTEGER NOT NULL DEFAULT 0,
  update_time    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, device_id)
);

CREATE INDEX idx_note_open_update ON note_open(update_time);
