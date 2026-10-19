-- Recovery identity is shared by both sync domains. Restore tools MUST rotate
-- the deployment epoch outside the database as well as this database epoch.
CREATE TABLE sync_instance (id INTEGER PRIMARY KEY CHECK (id = 1), epoch TEXT NOT NULL);
INSERT INTO sync_instance VALUES (1, lower(hex(randomblob(16))));
ALTER TABLE sync_checkpoint ADD COLUMN domain TEXT NOT NULL DEFAULT 'notes';
ALTER TABLE sync_checkpoint ADD COLUMN epoch TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_checkpoint ADD COLUMN revision TEXT NOT NULL DEFAULT '';
CREATE TABLE sync_revision (domain TEXT PRIMARY KEY, revision TEXT NOT NULL);
INSERT INTO sync_revision VALUES ('notes', lower(hex(randomblob(16)))), ('books', lower(hex(randomblob(16))));
CREATE INDEX sync_checkpoint_domain ON sync_checkpoint(domain, epoch, watermark, expires_at);

CREATE TRIGGER sync_revision_note_insert AFTER INSERT ON note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_update AFTER UPDATE ON note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_delete AFTER DELETE ON note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_body_insert AFTER INSERT ON note_body
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_body_update AFTER UPDATE ON note_body
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_body_delete AFTER DELETE ON note_body
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_group_insert AFTER INSERT ON note_group
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_group_update AFTER UPDATE ON note_group
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_note_group_delete AFTER DELETE ON note_group
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'notes'; END;

CREATE TRIGGER sync_revision_knowledge_base_insert AFTER INSERT ON knowledge_base
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_update AFTER UPDATE ON knowledge_base
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_delete AFTER DELETE ON knowledge_base
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_toc_insert AFTER INSERT ON knowledge_base_toc
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_toc_update AFTER UPDATE ON knowledge_base_toc
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_toc_delete AFTER DELETE ON knowledge_base_toc
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_deleted_note_insert AFTER INSERT ON knowledge_base_deleted_note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_deleted_note_update AFTER UPDATE ON knowledge_base_deleted_note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;

CREATE TRIGGER sync_revision_knowledge_base_deleted_note_delete AFTER DELETE ON knowledge_base_deleted_note
BEGIN UPDATE sync_revision SET revision = lower(hex(randomblob(16))) WHERE domain = 'books'; END;
