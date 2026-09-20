-- 云端正文历史：PATCH 覆盖正文时按 shared/history-rules.ts 的规则把被替换的旧正文存一条，
-- 与本机 IndexedDB 的 history 表同一套阈值。每条笔记最多 20 条、30 天，purgeNotes 连带清理。
CREATE TABLE note_history (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id  TEXT    NOT NULL,
  time     INTEGER NOT NULL,
  body     TEXT    NOT NULL
);
CREATE INDEX idx_note_history_note ON note_history(note_id, time);
