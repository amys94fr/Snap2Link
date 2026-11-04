-- One row per install. The token itself is never stored.
CREATE TABLE guests (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX guests_expires_at ON guests (expires_at);

-- Who sent a capture, so that abuse can lead to a ban. Gone with the capture.
ALTER TABLE captures ADD COLUMN guest_hash TEXT;
