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

/** Captures one address can send per UTC day without an account. */
export const ANONYMOUS_DAILY_LIMIT = 5;

/** Captures the whole service accepts per UTC day. */
export const GLOBAL_DAILY_LIMIT = 3_000;

/** Bytes kept at once. Leaves most of the free 10 GB to the rest of the account. */
export const MAX_STORED_BYTES = 2_000_000_000;

/** Objects freed per cleanup run: one bulk delete takes up to 1,000 keys. */
export const PURGE_BATCH = 1_000;
