import { ANONYMOUS_DAILY_LIMIT, MAX_CAPTURE_BYTES } from "./limits";
import {
  createCapture,
  deleteCapture,
  liveCaptureSize,
  purgeExpired,
  utcDay,
  type Storage,
} from "./store";

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  /** Base of the links handed out, without a trailing slash. */
  PUBLIC_URL: string;
  /** Where to report a capture. Shown on the home page. */
  ABUSE_CONTACT: string;
  /** Secret that makes hashed addresses impossible to reverse. */
  IP_SALT: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 22;

/** Links are only as private as they are unguessable: about 131 random bits. */
const CAPTURE_PATH = /^\/([0-9A-Za-z]{22})\.png$/;
const API_CAPTURE_PATH = /^\/v1\/captures\/([0-9A-Za-z]{22})$/;

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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
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

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_CAPTURE_BYTES) return error(413, "too_large");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_CAPTURE_BYTES) return error(413, "too_large");
  if (!isPng(bytes)) return error(415, "not_png");

  const now = Date.now();
  const id = randomId();
  const deleteToken = randomToken();
  const result = await createCapture(storage(env), {
    id,
    deleteHash: await sha256(deleteToken),
    bytes,
    ownerKey: await ownerKey(request, env.IP_SALT, now),
    ownerLimit: ANONYMOUS_DAILY_LIMIT,
    now,
  });

  if ("refused" in result) {
    return error(result.refused === "daily_limit" ? 429 : 503, result.refused);
  }
  return Response.json(
    {
      id,
      url: `${env.PUBLIC_URL}/${id}.png`,
      delete_token: deleteToken,
      expires_at: new Date(result.expiresAt).toISOString(),
    },
    { status: 201 },
  );
}

async function handleImage(id: string, env: Env, head: boolean): Promise<Response> {
  // D1 decides whether the link is alive: R2 may still hold an expired image.
  const size = await liveCaptureSize(env.DB, id, Date.now());
  if (size === null) return error(404, "not_found");

  const image = head ? null : await env.IMAGES.get(id);
  if (!head && !image) return error(404, "not_found");

  return new Response(image?.body ?? null, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(size),
      // A deleted or expired link must stop working at once, everywhere.
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

async function handleDelete(
  id: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
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

    if (pathname === "/v1/captures") {
      return method === "POST" ? handleUpload(request, env) : error(405, "method_not_allowed");
    }

    const apiCapture = API_CAPTURE_PATH.exec(pathname);
    if (apiCapture) {
      return method === "DELETE"
        ? handleDelete(apiCapture[1], request, env)
        : error(405, "method_not_allowed");
    }

    const image = CAPTURE_PATH.exec(pathname);
    if (image) {
      return method === "GET" || method === "HEAD"
        ? handleImage(image[1], env, method === "HEAD")
        : error(405, "method_not_allowed");
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
