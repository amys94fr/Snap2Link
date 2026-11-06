-- A pinned link isn't ended when an account's slots are full.
ALTER TABLE captures ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX captures_guest_hash ON captures (guest_hash);
