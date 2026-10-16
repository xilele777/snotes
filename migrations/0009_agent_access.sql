-- Agent credentials are independent of the instance owner credential.
-- Only a SHA-256 digest of the random 256-bit secret is retained.
CREATE TABLE agent_token (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  notebook_ids_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER
);

-- A successful write, its acknowledgement, and its audit record commit together.
-- Retain acknowledgements across subsequent edits and notebook/note deletion.
CREATE TABLE agent_operation (
  token_id TEXT NOT NULL REFERENCES agent_token(id),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  commit_id TEXT NOT NULL UNIQUE,
  response_json TEXT NOT NULL,
  action TEXT NOT NULL,
  notebook_id TEXT NOT NULL,
  note_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_id, operation_id)
);
CREATE INDEX agent_operation_time ON agent_operation(created_at DESC);
