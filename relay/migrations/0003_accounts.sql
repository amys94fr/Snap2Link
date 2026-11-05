-- A verified address. `id` is a keyed hash of it, so that a code can be pending
-- without the address being stored, and a deleted account can't reset its quota.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One row per signed-in install. The token itself is never stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_account_id ON sessions (account_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- The last code sent for an address, whether or not an account exists yet.
CREATE TABLE login_codes (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX login_codes_expires_at ON login_codes (expires_at);

ALTER TABLE captures ADD COLUMN account_id TEXT;

CREATE INDEX captures_account_id ON captures (account_id);
