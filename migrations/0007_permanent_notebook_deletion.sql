ALTER TABLE knowledge_base ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1));
-- Durable IDs prevent stale clients from restoring permanently deleted content.
CREATE TABLE knowledge_base_deleted_note (note_id TEXT NOT NULL, knowledge_base_id TEXT NOT NULL, PRIMARY KEY (note_id, knowledge_base_id));
CREATE INDEX knowledge_base_deleted_note_book ON knowledge_base_deleted_note(knowledge_base_id);
CREATE TABLE knowledge_base_deleted_image (file_key TEXT PRIMARY KEY, knowledge_base_id TEXT NOT NULL);
CREATE TRIGGER permanent_note_insert BEFORE INSERT ON note
WHEN EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER permanent_history_insert BEFORE INSERT ON note_history
WHEN EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.note_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER permanent_open_insert BEFORE INSERT ON note_open
WHEN EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.note_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER permanent_note_update BEFORE UPDATE ON note
WHEN NEW.invalid != 2 AND EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER permanent_body_insert BEFORE INSERT ON note_body
WHEN EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.note_id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER permanent_body_update BEFORE UPDATE ON note_body
WHEN EXISTS (SELECT 1 FROM knowledge_base_deleted_note WHERE note_id = NEW.note_id)
BEGIN SELECT RAISE(IGNORE); END;
