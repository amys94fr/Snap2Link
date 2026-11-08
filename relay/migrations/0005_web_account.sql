-- The online account area: a display name and a language, and sessions that
-- can be listed and closed one by one.
ALTER TABLE accounts ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN language TEXT;

ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'app';
ALTER TABLE sessions ADD COLUMN public_id TEXT;
UPDATE sessions SET public_id = lower(hex(randomblob(12))) WHERE public_id IS NULL;
CREATE UNIQUE INDEX sessions_public_id ON sessions (public_id);
