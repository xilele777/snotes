CREATE TABLE knowledge_base (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0 CHECK (invalid IN (0, 1)),
  meta_version INTEGER NOT NULL DEFAULT 1,
  toc_version INTEGER NOT NULL DEFAULT 0,
  create_time INTEGER NOT NULL,
  update_time INTEGER NOT NULL,
  change_seq INTEGER NOT NULL DEFAULT 0,
  last_operation_id TEXT NOT NULL
);
CREATE INDEX knowledge_base_changes ON knowledge_base(change_seq);
CREATE TABLE knowledge_base_clock (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT INTO knowledge_base_clock VALUES (1, 0);
CREATE TABLE knowledge_base_toc (
  knowledge_base_id TEXT PRIMARY KEY REFERENCES knowledge_base(id),
  version INTEGER NOT NULL DEFAULT 0,
  nodes_json TEXT NOT NULL DEFAULT '[]',
  update_time INTEGER NOT NULL,
  last_operation_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE knowledge_base_toc_history (
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id),
  version INTEGER NOT NULL,
  nodes_json TEXT NOT NULL,
  update_time INTEGER NOT NULL,
  PRIMARY KEY (knowledge_base_id, version)
);
-- Keep operation acknowledgements independently of the bounded history: a lost
-- response must remain replayable even after later edits and history pruning.
CREATE TABLE knowledge_base_operation (
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_base(id),
  operation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  meta_version INTEGER NOT NULL,
  toc_version INTEGER NOT NULL,
  update_time INTEGER NOT NULL,
  PRIMARY KEY (knowledge_base_id, operation_id)
);
