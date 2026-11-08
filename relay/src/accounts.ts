import {
  BLOCK_DAILY_CODES,
  BLOCK_DAILY_GOOGLE,
  EMAIL_DAILY_CODES,
  GLOBAL_DAILY_CODES,
  LOGIN_CODE_ATTEMPTS,
  LOGIN_CODE_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  WEB_SESSION_LIFETIME_MS,
  type Plan,
} from "./limits";
import {
  releaseBytes,
  returnQuota,
  takeQuotas,
  utcDay,
  type Quota,
  type Refusal,
  type Storage,
} from "./store";

const GLOBAL_CODES_KEY = "global-codes";

export interface Account {
  id: string;
  email: string;
  plan: Plan;
}

/** Where a session was opened: the app keeps it a year, the website a month. */
export type SessionKind = "app" | "web";

function publicId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const accountQuotaKey = (accountId: string) => `account:${accountId}`;

/** What one login code counts against. */
function codeQuotas(accountId: string, blockKey: string): Quota[] {
  return [
    { key: `code-email:${accountId}`, limit: EMAIL_DAILY_CODES },
    { key: `code-${blockKey}`, limit: BLOCK_DAILY_CODES },
    { key: GLOBAL_CODES_KEY, limit: GLOBAL_DAILY_CODES },
  ];
}

/** Keeps a new code for this address, replacing any earlier one. */
export async function createLoginCode(
  db: D1Database,
  accountId: string,
  codeHash: string,
  blockKey: string,
  now: number,
): Promise<{ expiresAt: number } | { refused: Refusal }> {
  const refused = await takeQuotas(db, codeQuotas(accountId, blockKey), utcDay(now));
  if (refused) {
    return { refused: refused.key === GLOBAL_CODES_KEY ? "service_busy" : "daily_limit" };
  }

  const expiresAt = now + LOGIN_CODE_LIFETIME_MS;
  await db
    .prepare(
      `INSERT INTO login_codes (account_id, code_hash, expires_at, attempts)
       VALUES (?1, ?2, ?3, 0)
       ON CONFLICT (account_id) DO UPDATE
       SET code_hash = ?2, expires_at = ?3, attempts = 0`,
    )
    .bind(accountId, codeHash, expiresAt)
    .run();
  return { expiresAt };
}

/** False when this address block used its Google sign-ins of the day. */
export async function takeGoogleAttempt(
  db: D1Database,
  blockKey: string,
  now: number,
): Promise<boolean> {
  const quota = { key: `google-${blockKey}`, limit: BLOCK_DAILY_GOOGLE };
  return (await takeQuotas(db, [quota], utcDay(now))) === null;
}

/** Forgets a code that never reached its address, and what it counted. */
export async function cancelLoginCode(
  db: D1Database,
  accountId: string,
  blockKey: string,
  now: number,
): Promise<void> {
  const day = utcDay(now);
  await db.batch([
    db.prepare("DELETE FROM login_codes WHERE account_id = ?1").bind(accountId),
    ...codeQuotas(accountId, blockKey).map(({ key }) => returnQuota(db, key, day)),
  ]);
}

/**
 * True when `codeHash` is the live code of this address, which then stops
 * working. The attempt is counted first and in one statement, so that parallel
 * guesses can't get past the limit.
 */
export async function useLoginCode(
  db: D1Database,
  accountId: string,
  codeHash: string,
  now: number,
): Promise<boolean> {
  const code = await db
    .prepare(
      `UPDATE login_codes SET attempts = attempts + 1
       WHERE account_id = ?1 AND expires_at > ?2 AND attempts < ?3
       RETURNING code_hash`,
    )
    .bind(accountId, now, LOGIN_CODE_ATTEMPTS)
    .first<{ code_hash: string }>();
  if (code?.code_hash !== codeHash) return false;

  await db.prepare("DELETE FROM login_codes WHERE account_id = ?1").bind(accountId).run();
  return true;
}

/** Signs in, creating the account the first time. Null when it is banned. */
export async function openSession(
  db: D1Database,
  accountId: string,
  email: string,
  tokenHash: string,
  now: number,
  kind: SessionKind = "app",
): Promise<{ account: Account; expiresAt: number } | null> {
  const account = await db
    .prepare(
      `INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (id) DO UPDATE SET email = email
       RETURNING id, email, plan, banned`,
    )
    .bind(accountId, email, now)
    .first<Account & { banned: number }>();
  if (!account || account.banned) return null;

  const expiresAt = now + (kind === "web" ? WEB_SESSION_LIFETIME_MS : SESSION_LIFETIME_MS);
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, account_id, created_at, expires_at, kind, public_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(tokenHash, accountId, now, expiresAt, kind, publicId())
    .run();
  return { account: { id: account.id, email: account.email, plan: account.plan }, expiresAt };
}

export type SessionStatus = Account | "banned" | "unknown";

/** An expired session is unknown: the app answers by asking to sign in again. */
export async function sessionAccount(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<SessionStatus> {
  const account = await db
    .prepare(
      `SELECT accounts.id, accounts.email, accounts.plan, accounts.banned
       FROM sessions JOIN accounts ON accounts.id = sessions.account_id
       WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2`,
    )
    .bind(tokenHash, now)
    .first<Account & { banned: number }>();
  if (!account) return "unknown";
  if (account.banned) return "banned";
  return { id: account.id, email: account.email, plan: account.plan };
}

export async function closeSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
}

export interface Usage {
  capturesToday: number;
  slotsUsed: number;
}

export async function accountUsage(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<Usage> {
  const [today, live] = await db.batch<{ value: number }>([
    db
      .prepare("SELECT count AS value FROM usage WHERE key = ?1 AND day = ?2")
      .bind(accountQuotaKey(accountId), utcDay(now)),
    db
      .prepare("SELECT COUNT(*) AS value FROM captures WHERE account_id = ?1 AND expires_at > ?2")
      .bind(accountId, now),
  ]);
  return {
    capturesToday: today.results[0]?.value ?? 0,
    slotsUsed: live.results[0]?.value ?? 0,
  };
}

export interface Profile {
  name: string;
  language: string | null;
  createdAt: number;
}

export async function accountProfile(db: D1Database, accountId: string): Promise<Profile> {
  const row = await db
    .prepare("SELECT name, language, created_at FROM accounts WHERE id = ?1")
    .bind(accountId)
    .first<{ name: string; language: string | null; created_at: number }>();
  return { name: row?.name ?? "", language: row?.language ?? null, createdAt: row?.created_at ?? 0 };
}

export async function updateProfile(
  db: D1Database,
  accountId: string,
  changes: { name?: string; language?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE accounts SET name = coalesce(?2, name), language = coalesce(?3, language)
       WHERE id = ?1`,
    )
    .bind(accountId, changes.name ?? null, changes.language ?? null)
    .run();
}

export interface SessionInfo {
  id: string;
  kind: SessionKind;
  created_at: number;
  current: boolean;
}

/** The live sessions of an account, newest first. Tokens never leave the database. */
export async function listSessions(
  db: D1Database,
  accountId: string,
  currentHash: string,
  now: number,
): Promise<SessionInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT public_id AS id, kind, created_at, token_hash = ?3 AS current FROM sessions
       WHERE account_id = ?1 AND expires_at > ?2 ORDER BY created_at DESC`,
    )
    .bind(accountId, now, currentHash)
    .all<{ id: string; kind: SessionKind; created_at: number; current: number }>();
  return results.map((row) => ({ ...row, current: row.current === 1 }));
}

/** True when the session existed and belonged to the account. */
export async function closeSessionById(
  db: D1Database,
  accountId: string,
  id: string,
): Promise<boolean> {
  const { meta } = await db
    .prepare("DELETE FROM sessions WHERE public_id = ?1 AND account_id = ?2")
    .bind(id, accountId)
    .run();
  return meta.changes > 0;
}

export async function closeOtherSessions(
  db: D1Database,
  accountId: string,
  currentHash: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE account_id = ?1 AND token_hash != ?2")
    .bind(accountId, currentHash)
    .run();
}

/**
 * Moves an account to a new address. Its id is a keyed hash of the address, so
 * every row that names the account moves with it. False when the new address
 * already has an account.
 */
export async function changeEmail(
  db: D1Database,
  oldId: string,
  newId: string,
  email: string,
): Promise<boolean> {
  const taken = await db.prepare("SELECT 1 FROM accounts WHERE id = ?1").bind(newId).first();
  if (taken) return false;
  await db.batch([
    db.prepare("UPDATE accounts SET id = ?2, email = ?3 WHERE id = ?1").bind(oldId, newId, email),
    db.prepare("UPDATE sessions SET account_id = ?2 WHERE account_id = ?1").bind(oldId, newId),
    db.prepare("UPDATE captures SET account_id = ?2 WHERE account_id = ?1").bind(oldId, newId),
    db
      .prepare("UPDATE OR IGNORE usage SET key = ?2 WHERE key = ?1")
      .bind(accountQuotaKey(oldId), accountQuotaKey(newId)),
    db.prepare("DELETE FROM usage WHERE key = ?1").bind(accountQuotaKey(oldId)),
  ]);
  return true;
}

/** Removes an account, its sessions and every capture it still has. */
export async function deleteAccount({ db, images }: Storage, accountId: string): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, size FROM captures WHERE account_id = ?1")
    .bind(accountId)
    .all<{ id: string; size: number }>();

  if (results.length > 0) await images.delete(results.map((capture) => capture.id));
  await db.batch([
    db.prepare("DELETE FROM captures WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM sessions WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM login_codes WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM accounts WHERE id = ?1").bind(accountId),
    releaseBytes(
      db,
      results.reduce((total, capture) => total + capture.size, 0),
    ),
  ]);
}
