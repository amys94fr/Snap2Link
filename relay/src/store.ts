import {
  BLOCK_GUESTS_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  GLOBAL_GUESTS_DAILY_LIMIT,
  GUEST_LIFETIME_MS,
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
const GLOBAL_GUESTS_KEY = "global-guests";
const BYTES_KEY = "stored_bytes";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

export interface Quota {
  key: string;
  limit: number;
}

/** Takes every quota, or none: returns the one that refused. */
async function takeQuotas(
  db: D1Database,
  quotas: Quota[],
  day: string,
): Promise<Quota | null> {
  const taken: Quota[] = [];
  for (const quota of quotas) {
    if (!(await takeQuota(db, quota.key, day, quota.limit))) {
      if (taken.length > 0) {
        await db.batch(taken.map(({ key }) => returnQuota(db, key, day)));
      }
      return quota;
    }
    taken.push(quota);
  }
  return null;
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

/** Reads only the start of what R2 stored. */
async function storedPng(images: R2Bucket, id: string): Promise<boolean> {
  const start = await images.get(id, { range: { length: PNG_SIGNATURE.length } });
  if (!start) return false;
  const bytes = new Uint8Array(await start.arrayBuffer());
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export interface NewCapture {
  id: string;
  deleteHash: string;
  guestHash: string;
  /** Never read in JS: copying 5 MB through it costs most of a request's 10 ms of CPU. */
  body: ReadableStream;
  /** What the sender declared. The stream fails if it carries anything else. */
  size: number;
  /** What the sender may use, checked in this order. */
  quotas: Quota[];
  now: number;
}

/**
 * Stores a capture, or says what refused it. A file that isn't a PNG keeps its
 * place in the quotas: it was written to R2 before anyone could tell, and those
 * writes have to stay limited.
 */
export async function createCapture(
  { db, images }: Storage,
  capture: NewCapture,
): Promise<{ expiresAt: number } | { refused: Refusal | "not_png" }> {
  const { id, deleteHash, guestHash, body, size, now } = capture;
  const day = utcDay(now);
  const quotas = [...capture.quotas, { key: GLOBAL_KEY, limit: GLOBAL_DAILY_LIMIT }];
  const giveBack = () => quotas.map(({ key }) => returnQuota(db, key, day));

  const refused = await takeQuotas(db, quotas, day);
  if (refused) {
    return { refused: refused.key === GLOBAL_KEY ? "service_busy" : "daily_limit" };
  }
  if (!(await reserveBytes(db, size))) {
    await db.batch(giveBack());
    return { refused: "service_busy" };
  }

  const expiresAt = now + LINK_LIFETIME_MS;
  try {
    await images.put(id, body.pipeThrough(new FixedLengthStream(size)), {
      httpMetadata: { contentType: "image/png" },
    });
    if (!(await storedPng(images, id))) {
      await images.delete(id);
      await db.batch([releaseBytes(db, size)]);
      return { refused: "not_png" };
    }
    await db
      .prepare(
        `INSERT INTO captures (id, delete_hash, guest_hash, size, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, deleteHash, guestHash, size, now, expiresAt)
      .run();
  } catch (err) {
    await images.delete(id);
    await db.batch([releaseBytes(db, size), ...giveBack()]);
    throw err;
  }
  return { expiresAt };
}

/** Records a guest, or says which limit refused it. */
export async function createGuest(
  db: D1Database,
  tokenHash: string,
  blockKey: string,
  now: number,
): Promise<{ expiresAt: number } | { refused: Refusal }> {
  const refused = await takeQuotas(
    db,
    [
      { key: `new-${blockKey}`, limit: BLOCK_GUESTS_DAILY_LIMIT },
      { key: GLOBAL_GUESTS_KEY, limit: GLOBAL_GUESTS_DAILY_LIMIT },
    ],
    utcDay(now),
  );
  if (refused) {
    return { refused: refused.key === GLOBAL_GUESTS_KEY ? "service_busy" : "daily_limit" };
  }

  const expiresAt = now + GUEST_LIFETIME_MS;
  await db
    .prepare("INSERT INTO guests (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)")
    .bind(tokenHash, now, expiresAt)
    .run();
  return { expiresAt };
}

export type GuestStatus = "valid" | "banned" | "unknown";

/** An expired guest is unknown: the app answers by getting a new one. */
export async function guestStatus(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<GuestStatus> {
  const guest = await db
    .prepare("SELECT banned FROM guests WHERE token_hash = ?1 AND expires_at > ?2")
    .bind(tokenHash, now)
    .first<{ banned: number }>();
  if (!guest) return "unknown";
  return guest.banned ? "banned" : "valid";
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

/** Cron job: frees what expired, and forgets past counters and old guests. */
export async function purgeExpired(
  { db, images }: Storage,
  now: number,
): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, size FROM captures WHERE expires_at <= ?1 LIMIT ?2")
    .bind(now, PURGE_BATCH)
    .all<{ id: string; size: number }>();

  const statements = [
    db.prepare("DELETE FROM usage WHERE day < ?1").bind(utcDay(now)),
    db.prepare("DELETE FROM guests WHERE expires_at <= ?1").bind(now),
  ];
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
