CREATE TABLE note (
  id            TEXT PRIMARY KEY,
  group_id      TEXT,
  title         TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  thumbnail     TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  prop_version  INTEGER NOT NULL DEFAULT 1,
  star          INTEGER NOT NULL DEFAULT 0,
  top           INTEGER NOT NULL DEFAULT 0,
  skin_color    TEXT,
  invalid       INTEGER NOT NULL DEFAULT 0,
  create_time   INTEGER NOT NULL,
  update_time   INTEGER NOT NULL
);
CREATE INDEX idx_note_update ON note(update_time);

CREATE TABLE note_body (
  note_id  TEXT PRIMARY KEY REFERENCES note(id) ON DELETE CASCADE,
  content  TEXT NOT NULL DEFAULT '',
  version  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE note_group (
  group_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  ord          INTEGER NOT NULL DEFAULT 0,
  color        TEXT,
  invalid      INTEGER NOT NULL DEFAULT 0,
  update_time  INTEGER NOT NULL
);
CREATE INDEX idx_group_update ON note_group(update_time);

CREATE TABLE image (
  file_key     TEXT PRIMARY KEY,
  note_id      TEXT NOT NULL,
  size         INTEGER NOT NULL,
  mime         TEXT NOT NULL,
  create_time  INTEGER NOT NULL
);
CREATE INDEX idx_image_note ON image(note_id);
