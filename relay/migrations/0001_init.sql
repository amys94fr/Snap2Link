-- Images themselves live in R2, under the capture id.
CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  delete_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX captures_expires_at ON captures (expires_at);

-- Captures counted per owner and per UTC day. `key` is a hash, never an address.
CREATE TABLE usage (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

-- Running totals, so that a limit check never scans a table.
CREATE TABLE stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT INTO stats (key, value) VALUES ('stored_bytes', 0);
