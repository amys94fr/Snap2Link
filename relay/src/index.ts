import {
  accountQuotaKey,
  accountUsage,
  cancelLoginCode,
  closeSession,
  createLoginCode,
  deleteAccount,
  openSession,
  sessionAccount,
  takeGoogleAttempt,
  useLoginCode,
  type Account,
} from "./accounts";
import {
  ACCOUNT_BLOCK_DAILY_LIMIT,
  BLOCK_DAILY_LIMIT,
  GUEST_DAILY_LIMIT,
  MAX_CAPTURE_BYTES,
  MAX_PREVIEW_BYTES,
  PLANS,
  PREVIEW_SIDE,
} from "./limits";
import { verifiedGoogleEmail } from "./google";
import { sendLoginCode } from "./mail";
import { handleMcp } from "./mcp";
import {
  createCapture,
  createGuest,
  deleteCapture,
  guestStatus,
  liveCaptureSize,
  purgeExpired,
  utcDay,
  type NewCapture,
  type Storage,
} from "./store";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Shrinks a capture for link previews. */
  RESIZER: ImagesBinding;
  /** Base of the links handed out, without a trailing slash. */
  PUBLIC_URL: string;
  /** Where to report a capture. Shown on the home page. */
  ABUSE_CONTACT: string;
  /** Secret that makes hashed addresses impossible to reverse. */
  IP_SALT: string;
  /** Public key of the Turnstile widget shown on `/guest`. */
  TURNSTILE_SITEKEY: string;
  /** Secret key of that widget. */
  TURNSTILE_SECRET: string;
  /** Sender of the login codes. */
  MAIL_FROM: string;
  /** Sends the login codes. */
  RESEND_API_KEY: string;
  /** Google ID tokens must be made for this client: the app's. */
  GOOGLE_CLIENT_ID: string;
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 22;

/** Links are only as private as they are unguessable: about 131 random bits. */
const CAPTURE_PATH = /^\/([0-9A-Za-z]{22})(\.png|\.jpg)?$/;
const API_CAPTURE_PATH = /^\/v1\/captures\/([0-9A-Za-z]{22})$/;

/**
 * These show a link as a card and need a page to build it from. Everything else
 * gets the image: browsers display it, and AI tools download it.
 */
const PREVIEW_BOT = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot/i;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "guest";
/** Turnstile tokens are 2,048 characters at most. */
const MAX_GUEST_REQUEST_BYTES = 4_096;
const MAX_LOGIN_REQUEST_BYTES = 1_024;
/** A Google ID token is about 1,200 characters. */
const MAX_GOOGLE_REQUEST_BYTES = 4_096;
const MAX_EMAIL_LENGTH = 254;

/** Tells a session from a guest token before asking the database. */
const SESSION_PREFIX = "s_";

const storage = (env: Env): Storage => ({ db: env.DB, images: env.IMAGES });

function randomId(): string {
  // 62 * 4 = 248: rejecting bytes above it keeps every character equally likely.
  let id = "";
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2))) {
      if (byte < 248 && id.length < ID_LENGTH) id += ALPHABET[byte % 62];
    }
  }
  return id;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Six digits, each value equally likely. */
function randomCode(): string {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return value < 4_294_000_000 ? String(value % 1_000_000).padStart(6, "0") : randomCode();
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function error(status: number, code: string): Response {
  return Response.json({ error: code }, { status });
}

/**
 * What a quota counts. One IPv6 connection owns a whole /64, billions of
 * addresses, so counting each of them would leave the limit without effect.
 */
function quotaBlock(address: string): string {
  if (!address.includes(":")) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];

  const [head, tail] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0");
  const prefix = [...left, ...zeros, ...right].slice(0, 4);
  return `${prefix.map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Addresses are never stored: only a hash that changes every day. */
function ownerKey(request: Request, salt: string, now: number): Promise<string> {
  const block = quotaBlock(request.headers.get("CF-Connecting-IP") ?? "unknown");
  return sha256(`${salt}:${utcDay(now)}:${block}`).then((hash) => `ip:${hash}`);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

/** The guest behind a request, or the answer that refuses it. */
async function requireGuest(request: Request, env: Env, now: number): Promise<string | Response> {
  const token = bearer(request);
  if (!token) return error(401, "guest_required");
  const guestHash = await sha256(token);
  const status = await guestStatus(env.DB, guestHash, now);
  if (status === "unknown") return error(401, "guest_required");
  if (status === "banned") return error(403, "guest_banned");
  return guestHash;
}

/** The account behind a request, or the answer that refuses it. */
async function requireAccount(
  request: Request,
  env: Env,
  now: number,
): Promise<{ account: Account; tokenHash: string } | Response> {
  const token = bearer(request);
  if (!token?.startsWith(SESSION_PREFIX)) return error(401, "session_required");
  const tokenHash = await sha256(token);
  const account = await sessionAccount(env.DB, tokenHash, now);
  if (account === "unknown") return error(401, "session_required");
  if (account === "banned") return error(403, "account_banned");
  return { account, tokenHash };
}

type Sender = Pick<NewCapture, "sender" | "quotas">;

/** Who is uploading and what they may use, or the answer that refuses them. */
async function uploadSender(request: Request, env: Env, now: number): Promise<Sender | Response> {
  if (bearer(request)?.startsWith(SESSION_PREFIX)) {
    const session = await requireAccount(request, env, now);
    if (session instanceof Response) return session;
    const { id, plan } = session.account;
    const { slots, dailyCaptures } = PLANS[plan];
    return {
      sender: { accountId: id, slots },
      quotas: [
        { key: accountQuotaKey(id), limit: dailyCaptures },
        {
          key: `account-${await ownerKey(request, env.IP_SALT, now)}`,
          limit: ACCOUNT_BLOCK_DAILY_LIMIT,
        },
      ],
    };
  }

  const guestHash = await requireGuest(request, env, now);
  if (guestHash instanceof Response) return guestHash;
  return {
    sender: { guestHash },
    quotas: [
      { key: `guest:${guestHash}`, limit: GUEST_DAILY_LIMIT },
      { key: await ownerKey(request, env.IP_SALT, now), limit: BLOCK_DAILY_LIMIT },
    ],
  };
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const sender = await uploadSender(request, env, now);
  if (sender instanceof Response) return sender;

  // The size has to be known up front: the body goes straight to R2.
  const size = Number(request.headers.get("Content-Length"));
  if (!request.body || !Number.isSafeInteger(size) || size <= 0) {
    return error(411, "length_required");
  }
  if (size > MAX_CAPTURE_BYTES) return error(413, "too_large");

  const id = randomId();
  const deleteToken = randomToken();
  const result = await createCapture(storage(env), {
    id,
    deleteHash: await sha256(deleteToken),
    ...sender,
    body: request.body,
    size,
    now,
  });

  if ("refused" in result) {
    const status = { daily_limit: 429, service_busy: 503, not_png: 415 }[result.refused];
    return error(status, result.refused);
  }
  return Response.json(
    {
      id,
      url: `${env.PUBLIC_URL}/${id}`,
      delete_token: deleteToken,
      expires_at: new Date(result.expiresAt).toISOString(),
    },
    { status: 201 },
  );
}

type Verdict = "passed" | "failed" | "unavailable";

async function verifyTurnstile(response: string, env: Env): Promise<Verdict> {
  try {
    const answer = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!answer.ok) return "unavailable";

    const result = await answer.json<{
      success: boolean;
      hostname?: string;
      action?: string;
      "error-codes"?: string[];
    }>();
    if (!result.success) {
      return result["error-codes"]?.includes("internal-error") ? "unavailable" : "failed";
    }
    // A token solved on another site, or for another purpose, proves nothing here.
    const host = new URL(env.PUBLIC_URL).hostname;
    return result.hostname === host && result.action === TURNSTILE_ACTION ? "passed" : "failed";
  } catch {
    return "unavailable";
  }
}

async function handleGuest(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_GUEST_REQUEST_BYTES) return error(400, "bad_request");

  let turnstile: unknown;
  try {
    turnstile = (JSON.parse(body) as { turnstile?: unknown } | null)?.turnstile;
  } catch {
    return error(400, "bad_request");
  }
  if (typeof turnstile !== "string" || turnstile.length === 0) {
    return error(400, "bad_request");
  }

  const verdict = await verifyTurnstile(turnstile, env);
  if (verdict === "unavailable") return error(503, "verification_unavailable");
  if (verdict === "failed") return error(403, "verification_failed");

  const now = Date.now();
  const guestToken = randomToken();
  const result = await createGuest(
    env.DB,
    await sha256(guestToken),
    await ownerKey(request, env.IP_SALT, now),
    now,
  );
  if ("refused" in result) {
    return error(result.refused === "daily_limit" ? 429 : 503, result.refused);
  }
  return Response.json(
    { guest_token: guestToken, expires_at: new Date(result.expiresAt).toISOString() },
    { status: 201 },
  );
}

/** A JSON object from a small request body, or null. */
async function loginBody(
  request: Request,
  maxBytes = MAX_LOGIN_REQUEST_BYTES,
): Promise<Record<string, unknown> | null> {
  const body = await request.text();
  if (body.length > maxBytes) return null;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The address as accounts know it, or null when it can't be one. */
function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)
    ? email
    : null;
}

/** Keyed, since a plain hash of an address can be found by trying addresses. */
const accountId = (email: string, env: Env) => sha256(`${env.IP_SALT}:account:${email}`);

/** Six digits alone would take a moment to find from their hash. */
const codeHash = (id: string, code: string, env: Env) =>
  sha256(`${env.IP_SALT}:code:${id}:${code}`);

/**
 * Sends a code. A guest token is required, so that Turnstile stands in front of
 * every email. The answer is the same for a new and a known address.
 */
async function handleLoginCode(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const guest = await requireGuest(request, env, now);
  if (guest instanceof Response) return guest;

  const body = await loginBody(request);
  if (!body) return error(400, "bad_request");
  const email = normalizedEmail(body.email);
  if (!email) return error(400, "invalid_email");

  const id = await accountId(email, env);
  const code = randomCode();
  const block = await ownerKey(request, env.IP_SALT, now);
  const result = await createLoginCode(env.DB, id, await codeHash(id, code, env), block, now);
  if ("refused" in result) {
    return error(result.refused === "daily_limit" ? 429 : 503, result.refused);
  }

  if (!(await sendLoginCode(env, email, code, body.language))) {
    await cancelLoginCode(env.DB, id, block, now);
    return error(503, "mail_unavailable");
  }
  return Response.json({ expires_at: new Date(result.expiresAt).toISOString() }, { status: 202 });
}

async function handleLoginVerify(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const guest = await requireGuest(request, env, now);
  if (guest instanceof Response) return guest;

  const body = await loginBody(request);
  const email = normalizedEmail(body?.email);
  if (!email || typeof body?.code !== "string") return error(400, "bad_request");

  const id = await accountId(email, env);
  if (!(await useLoginCode(env.DB, id, await codeHash(id, body.code, env), now))) {
    return error(400, "invalid_code");
  }

  return signIn(id, email, env, now);
}

/** Opens a session for an address that was just proved. */
async function signIn(id: string, email: string, env: Env, now: number): Promise<Response> {
  const sessionToken = `${SESSION_PREFIX}${randomToken()}`;
  const session = await openSession(env.DB, id, email, await sha256(sessionToken), now);
  if (!session) return error(403, "account_banned");
  return Response.json({
    session_token: sessionToken,
    expires_at: new Date(session.expiresAt).toISOString(),
    email: session.account.email,
    plan: session.account.plan,
  });
}

/**
 * Signs in with a Google ID token. An account is its address, so the same
 * person gets the same account with Google and with a code. A guest token is
 * required here too: Turnstile stands in front of every sign-in.
 */
async function handleLoginGoogle(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const guest = await requireGuest(request, env, now);
  if (guest instanceof Response) return guest;

  const body = await loginBody(request, MAX_GOOGLE_REQUEST_BYTES);
  if (typeof body?.id_token !== "string") return error(400, "bad_request");

  const block = await ownerKey(request, env.IP_SALT, now);
  if (!(await takeGoogleAttempt(env.DB, block, now))) return error(429, "daily_limit");

  const result = await verifiedGoogleEmail(body.id_token, env.GOOGLE_CLIENT_ID, now);
  if (result === "unavailable") return error(503, "service_busy");
  const email = result === "refused" ? null : normalizedEmail(result.email);
  if (!email) return error(403, "google_refused");

  return signIn(await accountId(email, env), email, env, now);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const session = await requireAccount(request, env, now);
  if (session instanceof Response) return session;
  const { id, email, plan } = session.account;

  if (request.method === "DELETE") {
    await deleteAccount(storage(env), id);
    return new Response(null, { status: 204 });
  }

  const usage = await accountUsage(env.DB, id, now);
  const { slots, dailyCaptures } = PLANS[plan];
  return Response.json({
    email,
    plan,
    captures_today: usage.capturesToday,
    daily_captures: dailyCaptures,
    slots_used: usage.slotsUsed,
    slots,
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const session = await requireAccount(request, env, Date.now());
  if (session instanceof Response) return session;
  await closeSession(env.DB, session.tokenHash);
  return new Response(null, { status: 204 });
}

/**
 * Opened by the app in a window of its own. The page has no text to translate
 * and no link to the app: it ends by going to `/guest/done`, a navigation the
 * app reads, so the page needs no access to the app. The result is in the
 * fragment, which a browser never sends: it stays out of requests and logs.
 */
function guestPage(env: Env): Response {
  const nonce = randomToken();
  const options = JSON.stringify({ sitekey: env.TURNSTILE_SITEKEY, action: TURNSTILE_ACTION });
  return new Response(
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Snap2Link</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
</style>
</head>
<body>
<div id="challenge"></div>
<script nonce="${nonce}">
const finish = (name, value) =>
  location.replace("/guest/done#" + new URLSearchParams({ [name]: value }));
function start() {
  turnstile.render("#challenge", {
    ...${options},
    callback: (token) => finish("turnstile", token),
    "error-callback": (code) => {
      finish("error", code);
      return true;
    },
    "timeout-callback": () => finish("error", "timeout"),
  });
}
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=start&render=explicit" async defer></script>
</body>
</html>
`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; ` +
          "frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; " +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

/** What's left on screen if the app doesn't stop the navigation in time. */
function guestDone(): Response {
  return new Response("You can close this window.\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const CAPTURE_HEADERS = {
  // A deleted or expired link must stop working at once, everywhere.
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

async function serveCapture(id: string, size: number, env: Env, head: boolean): Promise<Response> {
  const image = head ? null : await env.IMAGES.get(id);
  if (!head && !image) return error(404, "not_found");

  return new Response(image?.body ?? null, {
    headers: {
      ...CAPTURE_HEADERS,
      "Content-Type": "image/png",
      "Content-Length": String(size),
    },
  });
}

async function handleImage(id: string, env: Env, head: boolean): Promise<Response> {
  // D1 decides whether the link is alive: R2 may still hold an expired image.
  const size = await liveCaptureSize(env.DB, id, Date.now());
  if (size === null) return error(404, "not_found");
  return serveCapture(id, size, env, head);
}

/** The page a preview bot reads. People never see it. */
async function handlePreviewPage(id: string, env: Env, head: boolean): Promise<Response> {
  const size = await liveCaptureSize(env.DB, id, Date.now());
  if (size === null) return error(404, "not_found");

  const link = `${env.PUBLIC_URL}/${id}`;
  const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Screenshot</title>
<meta property="og:site_name" content="Snap2Link">
<meta property="og:type" content="website">
<meta property="og:title" content="Screenshot">
<meta property="og:url" content="${link}">
<meta property="og:image" content="${link}.jpg">
<meta name="twitter:card" content="summary_large_image">
</head>
<body><img src="${link}.png" alt="Screenshot"></body>
</html>
`;
  return new Response(head ? null : page, {
    headers: {
      ...CAPTURE_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}

async function handlePreviewImage(id: string, env: Env, head: boolean): Promise<Response> {
  const size = await liveCaptureSize(env.DB, id, Date.now());
  if (size === null) return error(404, "not_found");
  if (size <= MAX_PREVIEW_BYTES) return serveCapture(id, size, env, head);
  if (head) return new Response(null, { headers: { ...CAPTURE_HEADERS, "Content-Type": "image/jpeg" } });

  const image = await env.IMAGES.get(id);
  if (!image) return error(404, "not_found");

  try {
    const preview = await env.RESIZER.input(image.body)
      .transform({ width: PREVIEW_SIDE, height: PREVIEW_SIDE, fit: "scale-down" })
      .output({ format: "image/jpeg", quality: 75 });
    return preview.response({ headers: CAPTURE_HEADERS });
  } catch (cause) {
    // Past its free monthly resizes, Cloudflare refuses new ones and bills nothing.
    // The link still works: it just shows no picture in the chat.
    console.log(`preview refused: ${cause instanceof Error ? cause.message : "unknown"}`);
    return error(404, "not_found");
  }
}

async function handleDelete(
  id: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const token = bearer(request);
  if (!token) return error(401, "missing_token");
  const deleted = await deleteCapture(storage(env), id, await sha256(token));
  // The same answer either way: this can't be used to test which ids exist.
  return deleted ? new Response(null, { status: 204 }) : error(404, "not_found");
}

function home(env: Env): Response {
  return new Response(
    `Snap2Link relay: temporary links for screenshots.\n` +
      `Links expire after 6 hours.\n\n` +
      `Report a capture: ${env.ABUSE_CONTACT}\n` +
      `Source code: https://github.com/amys94fr/Snap2Link/tree/main/relay\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const { method } = request;

    if (pathname === "/mcp") {
      return handleMcp(request, env, await ownerKey(request, env.IP_SALT, Date.now()));
    }

    if (pathname === "/v1/captures") {
      return method === "POST" ? handleUpload(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/guests") {
      return method === "POST" ? handleGuest(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/login/code") {
      return method === "POST" ? handleLoginCode(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/login/verify") {
      return method === "POST" ? handleLoginVerify(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/login/google") {
      return method === "POST" ? handleLoginGoogle(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/logout") {
      return method === "POST" ? handleLogout(request, env) : error(405, "method_not_allowed");
    }

    if (pathname === "/v1/me") {
      return method === "GET" || method === "DELETE"
        ? handleMe(request, env)
        : error(405, "method_not_allowed");
    }

    if (pathname === "/guest" || pathname === "/guest/done") {
      if (method !== "GET") return error(405, "method_not_allowed");
      return pathname === "/guest" ? guestPage(env) : guestDone();
    }

    const apiCapture = API_CAPTURE_PATH.exec(pathname);
    if (apiCapture) {
      return method === "DELETE"
        ? handleDelete(apiCapture[1], request, env)
        : error(405, "method_not_allowed");
    }

    const capture = CAPTURE_PATH.exec(pathname);
    if (capture) {
      if (method !== "GET" && method !== "HEAD") return error(405, "method_not_allowed");
      const [, id, extension] = capture;
      const head = method === "HEAD";
      if (extension === ".jpg") return handlePreviewImage(id, env, head);
      if (!extension && PREVIEW_BOT.test(request.headers.get("User-Agent") ?? "")) {
        return handlePreviewPage(id, env, head);
      }
      return handleImage(id, env, head);
    }

    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (pathname === "/") return home(env);
    return error(404, "not_found");
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const removed = await purgeExpired(storage(env), Date.now());
    console.log(`purged ${removed} expired captures`);
  },
} satisfies ExportedHandler<Env>;
