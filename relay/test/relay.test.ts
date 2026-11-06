import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  BLOCK_DAILY_LIMIT,
  BLOCK_GUESTS_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  GLOBAL_GUESTS_DAILY_LIMIT,
  GUEST_DAILY_LIMIT,
  GUEST_LIFETIME_MS,
  GUEST_LINK_LIFETIME_MS,
  MAX_CAPTURE_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_STORED_BYTES,
  PREVIEW_SIDE,
} from "../src/limits";
import { purgeExpired, utcDay } from "../src/store";

const BASE = "https://i.snap2link.app";
const GUEST = "guest-token-used-by-most-tests";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const stored = async () => (await env.IMAGES.list()).objects.length;

const notAnImage = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

function png(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(SIGNATURE);
  for (let i = SIGNATURE.length; i < size; i += 1) bytes[i] = i % 251;
  return bytes;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request(`${BASE}${path}`, init) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(request, env);
  await waitOnExecutionContext(ctx);
  return response;
}

function upload(
  body: Uint8Array<ArrayBuffer> = png(),
  ip = "203.0.113.7",
  guest = GUEST,
): Promise<Response> {
  return call("/v1/captures", {
    method: "POST",
    body,
    headers: {
      "CF-Connecting-IP": ip,
      Authorization: `Bearer ${guest}`,
      "Content-Length": String(body.byteLength),
    },
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function addGuest(token: string, expiresAt = Date.now() + 60_000, banned = 0) {
  await env.DB.prepare(
    "INSERT INTO guests (token_hash, created_at, expires_at, banned) VALUES (?1, 0, ?2, ?3)",
  )
    .bind(await sha256(token), expiresAt, banned)
    .run();
}

/** What Turnstile answers, for the next verifications. */
function turnstileAnswers(answer: object | Error, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (answer instanceof Error) throw answer;
    return Response.json(answer, { status });
  });
}

const PASSED = { success: true, hostname: "i.snap2link.app", action: "guest" };

function askGuest(ip = "203.0.113.7", body: BodyInit = '{"turnstile":"solved"}') {
  return call("/v1/guests", { method: "POST", body, headers: { "CF-Connecting-IP": ip } });
}

interface Created {
  id: string;
  url: string;
  delete_token: string;
  expires_at: string;
}

const storage = { db: env.DB, images: env.IMAGES };

const storedBytes = async () =>
  (await env.DB.prepare("SELECT value FROM stats WHERE key = 'stored_bytes'").first<{
    value: number;
  }>())!.value;

beforeEach(async () => {
  vi.useRealTimers();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM captures"),
    env.DB.prepare("DELETE FROM guests"),
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("UPDATE stats SET value = 0"),
  ]);
  await addGuest(GUEST, Date.now() + GUEST_LIFETIME_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const WHATSAPP = { "User-Agent": "WhatsApp/2.26.21.74 A" };

/** Stands in for Cloudflare's resizer, which needs a real image. */
function resizer(outcome: "resizes" | "refuses") {
  const asked: unknown[] = [];
  const binding = {
    input: (stream: ReadableStream) => ({
      unread: stream.cancel(),
      transform(options: unknown) {
        asked.push(options);
        return this;
      },
      async output() {
        if (outcome === "refuses") throw new Error("IMAGES_TRANSFORM_ERROR 9422");
        return {
          response: ({ headers }: { headers: Record<string, string> }) =>
            new Response("small", { headers: { ...headers, "Content-Type": "image/jpeg" } }),
        };
      },
    }),
  } as unknown as ImagesBinding;
  return { asked, binding };
}

async function callWith(binding: ImagesBinding, path: string): Promise<Response> {
  const request = new Request(`${BASE}${path}`) as Parameters<typeof worker.fetch>[0];
  return worker.fetch(request, { ...env, RESIZER: binding });
}

describe("link previews", () => {
  it("gives preview bots a page that points to the picture", async () => {
    const { id } = await (await upload()).json<Created>();
    const response = await call(`/${id}`, { headers: WHATSAPP });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain(`property="og:image" content="${BASE}/${id}.jpg"`);
  });

  it.each([
    ["a browser", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0 Safari/537.36"],
    ["curl", "curl/8.9.1"],
    ["no agent", ""],
  ])("gives %s the image", async (_, agent) => {
    const { id } = await (await upload()).json<Created>();
    const response = await call(`/${id}`, { headers: { "User-Agent": agent } });
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("gives preview bots the image on an old .png link", async () => {
    const { id } = await (await upload()).json<Created>();
    const response = await call(`/${id}.png`, { headers: WHATSAPP });
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("shows no page for a link that doesn't exist", async () => {
    const response = await call(`/${"a".repeat(22)}`, { headers: WHATSAPP });
    expect(response.status).toBe(404);
  });

  it("stops the page and the picture when the capture is deleted", async () => {
    const { id, delete_token } = await (await upload()).json<Created>();
    await call(`/v1/captures/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${delete_token}` },
    });
    expect((await call(`/${id}`, { headers: WHATSAPP })).status).toBe(404);
    expect((await call(`/${id}.jpg`)).status).toBe(404);
  });

  it("serves a small capture as its own picture, without a resize", async () => {
    const image = png(MAX_PREVIEW_BYTES);
    const { id } = await (await upload(image)).json<Created>();
    const { asked, binding } = resizer("resizes");
    const response = await callWith(binding, `/${id}.jpg`);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect((await response.arrayBuffer()).byteLength).toBe(MAX_PREVIEW_BYTES);
    expect(asked).toEqual([]);
  });

  it("resizes a large capture and keeps it out of caches", async () => {
    const { id } = await (await upload(png(MAX_PREVIEW_BYTES + 1))).json<Created>();
    const { asked, binding } = resizer("resizes");
    const response = await callWith(binding, `/${id}.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(asked).toEqual([{ width: PREVIEW_SIDE, height: PREVIEW_SIDE, fit: "scale-down" }]);
  });

  it("keeps the link working when the resizer refuses", async () => {
    const { id } = await (await upload(png(MAX_PREVIEW_BYTES + 1))).json<Created>();
    const { binding } = resizer("refuses");
    expect((await callWith(binding, `/${id}.jpg`)).status).toBe(404);
    expect((await call(`/${id}`)).status).toBe(200);
  });
});

describe("upload and read", () => {
  it("returns a link that serves the exact image", async () => {
    const image = png(5000);
    const response = await upload(image);
    expect(response.status).toBe(201);
    const created = await response.json<Created>();
    expect(created.url).toBe(`${BASE}/${created.id}`);

    const served = await call(`/${created.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(image);
  });

  it("still serves links made with .png", async () => {
    const image = png(5000);
    const { id } = await (await upload(image)).json<Created>();
    const served = await call(`/${id}.png`);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(image);
  });

  it("handles the largest accepted capture", async () => {
    const image = png(MAX_CAPTURE_BYTES);
    const { id } = await (await upload(image)).json<Created>();

    const served = await call(`/${id}.png`);
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(bytes.byteLength).toBe(MAX_CAPTURE_BYTES);
    expect(Buffer.compare(bytes, image)).toBe(0);
  }, 20_000);

  it("can't be cached, sniffed or indexed", async () => {
    const { id } = await (await upload()).json<Created>();
    const { headers } = await call(`/${id}.png`);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Robots-Tag")).toContain("noindex");
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("answers HEAD without a body", async () => {
    const { id } = await (await upload(png(100))).json<Created>();
    const response = await call(`/${id}.png`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("100");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("gives unguessable, different links", async () => {
    const first = await (await upload()).json<Created>();
    const second = await (await upload()).json<Created>();
    expect(first.id).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(first.id).not.toBe(second.id);
  });

  it("refuses what isn't a PNG", async () => {
    const before = await stored();
    const response = await upload(notAnImage("<script>alert(1)</script>"));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "not_png" });
    expect(await storedBytes()).toBe(0);
    expect(await stored()).toBe(before);
  });

  it("counts what isn't a PNG, since it reached storage", async () => {
    const junk = notAnImage("not an image");
    for (let i = 0; i < GUEST_DAILY_LIMIT; i += 1) {
      expect((await upload(junk)).status).toBe(415);
    }
    expect((await upload()).status).toBe(429);
  });

  it("needs to know the size before reading the body", async () => {
    const response = await call("/v1/captures", {
      method: "POST",
      body: png(),
      headers: { Authorization: `Bearer ${GUEST}` },
    });
    expect(response.status).toBe(411);
    expect(await response.json()).toEqual({ error: "length_required" });
  });

  it("gives everything back when the body isn't the declared size", async () => {
    const before = await stored();
    await expect(
      call("/v1/captures", {
        method: "POST",
        body: png(100),
        headers: { Authorization: `Bearer ${GUEST}`, "Content-Length": "200" },
      }),
    ).rejects.toThrow();

    expect(await storedBytes()).toBe(0);
    expect(await stored()).toBe(before);
    const { results } = await env.DB.prepare("SELECT count FROM usage").all<{ count: number }>();
    expect(results.every(({ count }) => count === 0)).toBe(true);
  });

  it("refuses a capture that is too large", async () => {
    const response = await upload(png(MAX_CAPTURE_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await storedBytes()).toBe(0);
  });

  it("answers 404 for an unknown capture", async () => {
    const response = await call(`/${"a".repeat(22)}.png`);
    expect(response.status).toBe(404);
  });
});

describe("expiry", () => {
  it("kills the link at expiry, even before the cleanup job", async () => {
    const { id, expires_at } = await (await upload()).json<Created>();
    const lifetime = new Date(expires_at).getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(GUEST_LINK_LIFETIME_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(GUEST_LINK_LIFETIME_MS);

    vi.useFakeTimers({ now: new Date(expires_at).getTime() + 1 });
    expect((await call(`/${id}.png`)).status).toBe(404);
  });

  it("frees the space and the rows of expired captures only", async () => {
    const old = await (await upload(png(1000))).json<Created>();
    const expiry = new Date(old.expires_at).getTime();

    vi.useFakeTimers({ now: expiry - 1000 });
    const recent = await (await upload(png(500))).json<Created>();
    expect(await storedBytes()).toBe(1500);

    expect(await purgeExpired(storage, expiry)).toBe(1);

    expect(await storedBytes()).toBe(500);
    expect(await env.IMAGES.head(old.id)).toBeNull();
    expect(await env.IMAGES.head(recent.id)).not.toBeNull();
    const rows = await env.DB.prepare("SELECT id FROM captures").all();
    expect(rows.results).toEqual([{ id: recent.id }]);
  });

  it("forgets the counters of past days", async () => {
    await upload();
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    await purgeExpired(storage, tomorrow);
    const rows = await env.DB.prepare("SELECT day FROM usage").all();
    expect(rows.results).toEqual([]);
  });
});

describe("delete", () => {
  it("stops the link at once and frees the space", async () => {
    const { id, delete_token } = await (await upload(png(800))).json<Created>();

    const response = await call(`/v1/captures/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${delete_token}` },
    });

    expect(response.status).toBe(204);
    expect((await call(`/${id}.png`)).status).toBe(404);
    expect(await env.IMAGES.head(id)).toBeNull();
    expect(await storedBytes()).toBe(0);
  });

  it("refuses a wrong token and keeps the capture", async () => {
    const { id } = await (await upload()).json<Created>();
    const response = await call(`/v1/captures/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(response.status).toBe(404);
    expect((await call(`/${id}.png`)).status).toBe(200);
  });

  it("requires a token", async () => {
    const { id } = await (await upload()).json<Created>();
    const response = await call(`/v1/captures/${id}`, { method: "DELETE" });
    expect(response.status).toBe(401);
  });

  it("never stores the token itself", async () => {
    const { id, delete_token } = await (await upload()).json<Created>();
    const row = await env.DB.prepare("SELECT delete_hash FROM captures WHERE id = ?1")
      .bind(id)
      .first<{ delete_hash: string }>();
    expect(row?.delete_hash).not.toBe(delete_token);
  });
});

describe("limits", () => {
  it("stops a guest at the daily limit, not another one", async () => {
    for (let i = 0; i < GUEST_DAILY_LIMIT; i += 1) {
      expect((await upload()).status).toBe(201);
    }
    const refused = await upload();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "daily_limit" });

    await addGuest("other");
    expect((await upload(png(), "203.0.113.7", "other")).status).toBe(201);
  });

  it("doesn't let a guest escape its limit by changing address", async () => {
    for (let i = 0; i < GUEST_DAILY_LIMIT; i += 1) await upload();
    expect((await upload(png(), "198.51.100.9")).status).toBe(429);
  });

  it("stops an address block, however many guests it has", async () => {
    const guests = Math.ceil(BLOCK_DAILY_LIMIT / GUEST_DAILY_LIMIT) + 1;
    let accepted = 0;
    for (let g = 0; g < guests; g += 1) {
      await addGuest(`guest-${g}`);
      for (let i = 0; i < GUEST_DAILY_LIMIT; i += 1) {
        const address = `2001:db8:1:2::${g + 1}:${i + 1}`;
        const response = await upload(png(), address, `guest-${g}`);
        if (response.status === 201) accepted += 1;
      }
    }
    expect(accepted).toBe(BLOCK_DAILY_LIMIT);

    await addGuest("next-door");
    expect((await upload(png(), "2001:db8:1:3::1", "next-door")).status).toBe(201);
  });

  it("gives back the guest's place when its block refuses", async () => {
    const day = utcDay(Date.now());
    await upload();
    const { results } = await env.DB.prepare("SELECT key FROM usage WHERE key LIKE 'ip:%'").all<{
      key: string;
    }>();
    await env.DB.prepare("UPDATE usage SET count = ?1 WHERE key = ?2 AND day = ?3")
      .bind(BLOCK_DAILY_LIMIT, results[0].key, day)
      .run();

    expect((await upload()).status).toBe(429);

    const guest = await env.DB.prepare(
      "SELECT count FROM usage WHERE key LIKE 'guest:%'",
    ).first<{ count: number }>();
    expect(guest?.count).toBe(1);
  });

  const blocksUsed = async () => {
    const { results } = await env.DB.prepare(
      "SELECT count FROM usage WHERE key LIKE 'ip:%'",
    ).all<{ count: number }>();
    return results.map((row) => row.count);
  };

  it.each([
    ["uppercase", "2001:DB8:1:2::9"],
    ["leading zeros", "2001:0db8:0001:0002::9"],
    ["no compression", "2001:db8:1:2:0:0:0:9"],
    ["another interface", "2001:db8:1:2:aaaa:bbbb:cccc:dddd"],
  ])("sees the same /64 written with %s", async (_, address) => {
    await upload(png(), "2001:db8:1:2::1");
    await upload(png(), address);
    expect(await blocksUsed()).toEqual([2]);
  });

  it("finds the /64 when the compression reaches into it", async () => {
    await upload(png(), "2001:db8:0:0:1::");
    await upload(png(), "2001:db8::9");
    expect(await blocksUsed()).toEqual([2]);

    await upload(png(), "2001:db8:0:1::9");
    expect((await blocksUsed()).sort()).toEqual([1, 2]);
  });

  it("treats an IPv4 address in IPv6 form as the IPv4 address", async () => {
    await upload();
    await upload(png(), "::ffff:203.0.113.7");
    expect(await blocksUsed()).toEqual([2]);
  });

  it("lets simultaneous uploads take only the places left", async () => {
    const results = await Promise.all(
      Array.from({ length: GUEST_DAILY_LIMIT + 3 }, () => upload()),
    );
    const accepted = results.filter((r) => r.status === 201);
    expect(accepted).toHaveLength(GUEST_DAILY_LIMIT);
  });

  it("starts again the next UTC day", async () => {
    for (let i = 0; i < GUEST_DAILY_LIMIT; i += 1) await upload();
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60 * 1000 });
    expect((await upload()).status).toBe(201);
  });

  it("stops everyone at the global limit, without using their quota", async () => {
    await env.DB.prepare("INSERT INTO usage (key, day, count) VALUES ('global', ?1, ?2)")
      .bind(utcDay(Date.now()), GLOBAL_DAILY_LIMIT)
      .run();

    const refused = await upload();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "service_busy" });

    const owners = await env.DB.prepare(
      "SELECT SUM(count) AS total FROM usage WHERE key != 'global'",
    ).first<{ total: number }>();
    expect(owners?.total).toBe(0);
  });

  it("refuses when storage is full and gives the places back", async () => {
    await env.DB.prepare("UPDATE stats SET value = ?1").bind(MAX_STORED_BYTES - 10).run();

    const refused = await upload(png(64));
    expect(refused.status).toBe(503);

    expect(await storedBytes()).toBe(MAX_STORED_BYTES - 10);
    const counts = await env.DB.prepare("SELECT SUM(count) AS total FROM usage").first<{
      total: number;
    }>();
    expect(counts?.total).toBe(0);
  });

  it("keeps no address, only a daily hash", async () => {
    await upload(png(), "203.0.113.7");
    const { results } = await env.DB.prepare("SELECT key FROM usage").all<{ key: string }>();
    expect(results.some((r) => r.key.includes("203.0.113.7"))).toBe(false);
    expect(results.some((r) => /^ip:[0-9a-f]{64}$/.test(r.key))).toBe(true);
  });
});

describe("guests", () => {
  it("turns a passed challenge into a token that can upload", async () => {
    const siteverify = turnstileAnswers(PASSED);

    const response = await askGuest();
    expect(response.status).toBe(201);
    const { guest_token, expires_at } = await response.json<{
      guest_token: string;
      expires_at: string;
    }>();

    const [url, init] = siteverify.mock.calls[0];
    expect(url).toContain("/turnstile/v0/siteverify");
    expect(JSON.parse(init?.body as string)).toEqual({
      secret: "test-secret",
      response: "solved",
    });
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now());
    expect((await upload(png(), "203.0.113.7", guest_token)).status).toBe(201);
  });

  it("never stores the token itself", async () => {
    turnstileAnswers(PASSED);
    const { guest_token } = await (await askGuest()).json<{ guest_token: string }>();
    const stored = await env.DB.prepare("SELECT token_hash FROM guests WHERE token_hash = ?1")
      .bind(guest_token)
      .first();
    expect(stored).toBeNull();
  });

  it.each([
    ["a refused token", { success: false, "error-codes": ["invalid-input-response"] }],
    ["a token already used", { success: false, "error-codes": ["timeout-or-duplicate"] }],
    ["another site", { ...PASSED, hostname: "evil.example" }],
    ["another purpose", { ...PASSED, action: "login" }],
  ])("refuses %s", async (_, answer) => {
    turnstileAnswers(answer);
    const response = await askGuest();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "verification_failed" });

    const guests = await env.DB.prepare("SELECT COUNT(*) AS total FROM guests").first<{
      total: number;
    }>();
    expect(guests?.total).toBe(1);
  });

  it("doesn't count failed attempts against the address", async () => {
    turnstileAnswers({ success: false });
    for (let i = 0; i <= BLOCK_GUESTS_DAILY_LIMIT; i += 1) await askGuest();
    vi.restoreAllMocks();
    turnstileAnswers(PASSED);
    expect((await askGuest()).status).toBe(201);
  });

  it.each([
    ["is unreachable", new Error("network"), 200],
    ["answers an error", {}, 500],
    ["fails on its side", { success: false, "error-codes": ["internal-error"] }, 200],
  ])("says so when Turnstile %s", async (_, answer, status) => {
    turnstileAnswers(answer, status);
    const response = await askGuest();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "verification_unavailable" });
  });

  it.each([
    ["no body", ""],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["no token", "{}"],
    ["a token of the wrong type", '{"turnstile":1}'],
    ["an empty token", '{"turnstile":""}'],
    ["an oversized body", JSON.stringify({ turnstile: "a".repeat(5000) })],
  ])("refuses %s without asking Turnstile", async (_, body) => {
    const siteverify = turnstileAnswers(PASSED);
    expect((await askGuest("203.0.113.7", body)).status).toBe(400);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("limits the guests an address can create", async () => {
    turnstileAnswers(PASSED);
    for (let i = 1; i <= BLOCK_GUESTS_DAILY_LIMIT; i += 1) {
      expect((await askGuest(`2001:db8:1:2::${i}`)).status).toBe(201);
    }
    const refused = await askGuest("2001:db8:1:2::ffff");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "daily_limit" });

    expect((await askGuest("2001:db8:1:3::1")).status).toBe(201);
  });

  it("stops at the global limit of guests, without using the address's quota", async () => {
    turnstileAnswers(PASSED);
    await env.DB.prepare("INSERT INTO usage (key, day, count) VALUES ('global-guests', ?1, ?2)")
      .bind(utcDay(Date.now()), GLOBAL_GUESTS_DAILY_LIMIT)
      .run();

    const refused = await askGuest();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "service_busy" });

    const address = await env.DB.prepare(
      "SELECT SUM(count) AS total FROM usage WHERE key != 'global-guests'",
    ).first<{ total: number }>();
    expect(address?.total).toBe(0);
  });

  it.each([
    ["no token", {}],
    ["a wrong scheme", { Authorization: `Basic ${GUEST}` }],
    ["an unknown token", { Authorization: "Bearer nobody" }],
  ])("refuses an upload with %s", async (_, headers) => {
    const response = await call("/v1/captures", { method: "POST", body: png(), headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "guest_required" });
  });

  it("asks an expired guest to get a new token", async () => {
    await addGuest("old", Date.now() - 1);
    const response = await upload(png(), "203.0.113.7", "old");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "guest_required" });
  });

  it("refuses a banned guest and stores nothing", async () => {
    await addGuest("banned", Date.now() + 60_000, 1);
    const response = await upload(png(), "203.0.113.7", "banned");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "guest_banned" });
    expect(await storedBytes()).toBe(0);
  });

  it("can ban the guest behind a capture", async () => {
    const { id } = await (await upload()).json<Created>();

    await env.DB.prepare(
      "UPDATE guests SET banned = 1 WHERE token_hash = (SELECT guest_hash FROM captures WHERE id = ?1)",
    )
      .bind(id)
      .run();

    expect((await upload()).status).toBe(403);
  });

  it("forgets expired guests, not the others", async () => {
    await addGuest("old", Date.now() - 1);
    await purgeExpired(storage, Date.now());
    const { results } = await env.DB.prepare("SELECT token_hash FROM guests").all<{
      token_hash: string;
    }>();
    expect(results).toEqual([{ token_hash: await sha256(GUEST) }]);
  });

  it("serves the challenge page with its key and strict headers", async () => {
    const response = await call("/guest");
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const page = await response.text();
    expect(page).toContain(env.TURNSTILE_SITEKEY);
    expect(page).not.toContain("test-secret");

    const policy = response.headers.get("Content-Security-Policy");
    const nonce = /nonce="([0-9a-f]+)"/.exec(page)?.[1];
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("uses a new nonce each time", async () => {
    const nonce = async () =>
      /nonce="([0-9a-f]+)"/.exec(await (await call("/guest")).text())?.[1];
    expect(await nonce()).not.toBe(await nonce());
  });

  it("keeps the result in the fragment, away from the server", async () => {
    const page = await (await call("/guest")).text();
    expect(page).toContain('"/guest/done#"');
    expect(page).not.toContain('"/guest/done?"');
  });

  it("ends in a plain page when no app stops the navigation", async () => {
    const response = await call("/guest/done");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("routing", () => {
  it("shows where to report a capture", async () => {
    const response = await call("/");
    expect(await response.text()).toContain(env.ABUSE_CONTACT);
  });

  it("keeps robots away", async () => {
    expect(await (await call("/robots.txt")).text()).toContain("Disallow: /");
  });

  it("refuses the wrong methods and unknown paths", async () => {
    expect((await call("/v1/captures", { method: "PUT" })).status).toBe(405);
    expect((await call("/v1/guests")).status).toBe(405);
    expect((await call("/guest", { method: "POST" })).status).toBe(405);
    expect((await call(`/${"a".repeat(22)}.png`, { method: "POST" })).status).toBe(405);
    expect((await call("/../etc/passwd")).status).toBe(404);
    expect((await call("/short.png")).status).toBe(404);
  });
});
