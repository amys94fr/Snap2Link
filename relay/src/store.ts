import {
  GLOBAL_DAILY_LIMIT,
  LINK_LIFETIME_MS,
  MAX_STORED_BYTES,
  PURGE_BATCH,
} from "./limits";

/**
 * Images live in R2 and everything else in D1. Storing images in D1 would be
 * simpler, but its binding turns blobs into JSON, which costs about 28 ms per
 * MB against the 10 ms of CPU a request gets on Workers Free. KV isn't an
 * option either: 1,000 writes a day, and a new link can take 60 s to work
 * everywhere. R2 is immediately consistent and never touches the bytes in JS.
 */
export interface Storage {
  db: D1Database;
  images: R2Bucket;
}

const GLOBAL_KEY = "global";
const BYTES_KEY = "stored_bytes";

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Counts one capture against `key` unless that would pass `limit`. A single
 * statement, so two simultaneous uploads can't both take the last place.
 */
async function takeQuota(
  db: D1Database,
  key: string,
  day: string,
  limit: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO usage (key, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, day) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(key, day, limit)
    .first<{ count: number }>();
  return row !== null;
}

function returnQuota(db: D1Database, key: string, day: string) {
  return db
    .prepare("UPDATE usage SET count = count - 1 WHERE key = ?1 AND day = ?2")
    .bind(key, day);
}

async function reserveBytes(db: D1Database, size: number): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE stats SET value = value + ?1
       WHERE key = ?2 AND value + ?1 <= ?3
       RETURNING value`,
    )
    .bind(size, BYTES_KEY, MAX_STORED_BYTES)
    .first<{ value: number }>();
  return row !== null;
}

function releaseBytes(db: D1Database, size: number): D1PreparedStatement {
  return db
    .prepare("UPDATE stats SET value = MAX(value - ?1, 0) WHERE key = ?2")
    .bind(size, BYTES_KEY);
}

export type Refusal = "daily_limit" | "service_busy";

export interface NewCapture {
  id: string;
  deleteHash: string;
  bytes: Uint8Array;
  ownerKey: string;
  ownerLimit: number;
  now: number;
}

/** Stores a capture, or says which limit refused it. */
export async function createCapture(
  { db, images }: Storage,
  capture: NewCapture,
): Promise<{ expiresAt: number } | { refused: Refusal }> {
  const { id, deleteHash, bytes, ownerKey, ownerLimit, now } = capture;
  const day = utcDay(now);
  const size = bytes.byteLength;

  if (!(await takeQuota(db, ownerKey, day, ownerLimit))) {
    return { refused: "daily_limit" };
  }
  if (!(await takeQuota(db, GLOBAL_KEY, day, GLOBAL_DAILY_LIMIT))) {
    await returnQuota(db, ownerKey, day).run();
    return { refused: "service_busy" };
  }
  if (!(await reserveBytes(db, size))) {
    await db.batch([returnQuota(db, ownerKey, day), returnQuota(db, GLOBAL_KEY, day)]);
    return { refused: "service_busy" };
  }

  const expiresAt = now + LINK_LIFETIME_MS;
  try {
    await images.put(id, bytes, { httpMetadata: { contentType: "image/png" } });
    await db
      .prepare(
        `INSERT INTO captures (id, delete_hash, size, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(id, deleteHash, size, now, expiresAt)
      .run();
  } catch (err) {
    await images.delete(id);
    await db.batch([
      releaseBytes(db, size),
      returnQuota(db, ownerKey, day),
      returnQuota(db, GLOBAL_KEY, day),
    ]);
    throw err;
  }
  return { expiresAt };
}

/** Size of a live capture, or null when it doesn't exist or has expired. */
export async function liveCaptureSize(
  db: D1Database,
  id: string,
  now: number,
): Promise<number | null> {
  const capture = await db
    .prepare("SELECT size FROM captures WHERE id = ?1 AND expires_at > ?2")
    .bind(id, now)
    .first<{ size: number }>();
  return capture?.size ?? null;
}

/** True when the capture existed and `deleteHash` matched it. */
export async function deleteCapture(
  { db, images }: Storage,
  id: string,
  deleteHash: string,
): Promise<boolean> {
  const capture = await db
    .prepare("SELECT size FROM captures WHERE id = ?1 AND delete_hash = ?2")
    .bind(id, deleteHash)
    .first<{ size: number }>();
  if (!capture) return false;

  await images.delete(id);
  await db.batch([
    db.prepare("DELETE FROM captures WHERE id = ?1").bind(id),
    releaseBytes(db, capture.size),
  ]);
  return true;
}

/** Cron job: frees what expired, and forgets the counters of past days. */
export async function purgeExpired(
  { db, images }: Storage,
  now: number,
): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, size FROM captures WHERE expires_at <= ?1 LIMIT ?2")
    .bind(now, PURGE_BATCH)
    .all<{ id: string; size: number }>();

  const statements = [db.prepare("DELETE FROM usage WHERE day < ?1").bind(utcDay(now))];
  if (results.length > 0) {
    const ids = results.map((capture) => capture.id);
    await images.delete(ids);
    statements.push(
      db
        .prepare("DELETE FROM captures WHERE id IN (SELECT value FROM json_each(?1))")
        .bind(JSON.stringify(ids)),
      releaseBytes(
        db,
        results.reduce((total, capture) => total + capture.size, 0),
      ),
    );
  }
  await db.batch(statements);
  return results.length;
}
