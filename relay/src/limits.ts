/**
 * Every ceiling of the relay. Together they keep it inside Cloudflare's free
 * tiers: past these, requests are refused instead of billed.
 *
 * R2 bills beyond its free tier, so these are what stands between a traffic
 * spike and an invoice. Free tier as of 2026-11, per account and per month:
 * 10 GB stored, 1 million writes, 10 million reads.
 *   - Stored: capped by MAX_STORED_BYTES.
 *   - Writes: capped by GLOBAL_DAILY_LIMIT, about 90,000 a month.
 *   - Reads: one per request, so capped by the 100,000 requests a day of
 *     Workers Free, about 3 million a month. On Workers Paid nothing caps
 *     this one: add a limit before upgrading.
 */

/** Links die after this delay, whatever happens to the cleanup job. */
export const LINK_LIFETIME_MS = 6 * 60 * 60 * 1000;

/** Largest accepted capture. */
export const MAX_CAPTURE_BYTES = 5_000_000;

/**
 * Up to this size, a capture is its own preview and costs no resize. WhatsApp
 * documents 600 KB as its ceiling, and some reports say 300 KB.
 */
export const MAX_PREVIEW_BYTES = 300_000;

/** Longest side of a resized preview, in pixels. */
export const PREVIEW_SIDE = 800;

/** Captures one guest can send per UTC day. */
export const GUEST_DAILY_LIMIT = 5;

/**
 * Captures one address block can send per UTC day, whatever its guests. Above
 * a guest's limit, so that an office behind one address keeps working.
 */
export const BLOCK_DAILY_LIMIT = 30;

/** Guests one address block can create per UTC day. */
export const BLOCK_GUESTS_DAILY_LIMIT = 10;

/** Guests the whole service creates per UTC day. */
export const GLOBAL_GUESTS_DAILY_LIMIT = 5_000;

/** A guest has to pass the challenge again after this delay. */
export const GUEST_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** Captures the whole service accepts per UTC day. */
export const GLOBAL_DAILY_LIMIT = 3_000;

/** Bytes kept at once. Leaves most of the free 10 GB to the rest of the account. */
export const MAX_STORED_BYTES = 2_000_000_000;

/**
 * What each plan may do. `slots` is how many of an account's links work at
 * once: a new capture ends the oldest. Stored bytes stay bounded by
 * MAX_STORED_BYTES, whatever the number of accounts.
 */
export const PLANS = {
  free: { slots: 6, dailyCaptures: 20 },
} as const;

export type Plan = keyof typeof PLANS;

/** Captures one address block can send per UTC day through accounts. */
export const ACCOUNT_BLOCK_DAILY_LIMIT = 100;

/** A session lasts this long, and an account unused this long is forgotten. */
export const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/** How long a login code works. The emails say 10 minutes. */
export const LOGIN_CODE_LIFETIME_MS = 10 * 60 * 1000;

/** Guesses one login code allows. */
export const LOGIN_CODE_ATTEMPTS = 5;

/** Login codes one address can receive per UTC day. */
export const EMAIL_DAILY_CODES = 5;

/** Login codes one address block can ask for per UTC day. */
export const BLOCK_DAILY_CODES = 10;

/**
 * Login codes the whole service sends per UTC day. Resend's free plan stops at
 * 100 emails a day and 3,000 a month: this stays under both.
 */
export const GLOBAL_DAILY_CODES = 80;

/** Objects freed per cleanup run: one bulk delete takes up to 1,000 keys. */
export const PURGE_BATCH = 1_000;
