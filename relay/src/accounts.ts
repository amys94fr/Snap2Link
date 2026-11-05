import {
  BLOCK_DAILY_CODES,
  EMAIL_DAILY_CODES,
  GLOBAL_DAILY_CODES,
  LOGIN_CODE_ATTEMPTS,
  LOGIN_CODE_LIFETIME_MS,
  SESSION_LIFETIME_MS,
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

  const expiresAt = now + SESSION_LIFETIME_MS;
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(tokenHash, accountId, now, expiresAt)
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
