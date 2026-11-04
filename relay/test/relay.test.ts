import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  ANONYMOUS_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  LINK_LIFETIME_MS,
  MAX_CAPTURE_BYTES,
  MAX_STORED_BYTES,
} from "../src/limits";
import { purgeExpired, utcDay } from "../src/store";

const BASE = "https://i.snap2link.app";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function upload(body: BodyInit = png(), ip = "203.0.113.7"): Promise<Response> {
  return call("/v1/captures", {
    method: "POST",
    body,
    headers: { "CF-Connecting-IP": ip },
  });
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
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("UPDATE stats SET value = 0"),
  ]);
});

describe("upload and read", () => {
  it("returns a link that serves the exact image", async () => {
    const image = png(5000);
    const response = await upload(image);
    expect(response.status).toBe(201);
    const created = await response.json<Created>();
    expect(created.url).toBe(`${BASE}/${created.id}.png`);

    const served = await call(`/${created.id}.png`);
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
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
    const response = await upload(new TextEncoder().encode("<script>alert(1)</script>"));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "not_png" });
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
    expect(lifetime).toBeGreaterThan(LINK_LIFETIME_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(LINK_LIFETIME_MS);

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
  it("stops an address at the daily limit, not another one", async () => {
    for (let i = 0; i < ANONYMOUS_DAILY_LIMIT; i += 1) {
      expect((await upload()).status).toBe(201);
    }
    const refused = await upload();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "daily_limit" });

    expect((await upload(png(), "198.51.100.9")).status).toBe(201);
  });

  it("counts a whole IPv6 /64 as one address", async () => {
    for (let i = 1; i <= ANONYMOUS_DAILY_LIMIT; i += 1) {
      expect((await upload(png(), `2001:db8:1:2::${i}`)).status).toBe(201);
    }
    expect((await upload(png(), "2001:db8:1:2:aaaa:bbbb:cccc:dddd")).status).toBe(429);

    expect((await upload(png(), "2001:db8:1:3::1")).status).toBe(201);
  });

  it.each([
    ["uppercase", "2001:DB8:1:2::9"],
    ["leading zeros", "2001:0db8:0001:0002::9"],
    ["no compression", "2001:db8:1:2:0:0:0:9"],
  ])("sees the same /64 written with %s", async (_, address) => {
    for (let i = 1; i <= ANONYMOUS_DAILY_LIMIT; i += 1) {
      await upload(png(), `2001:db8:1:2::${i}`);
    }
    expect((await upload(png(), address)).status).toBe(429);
  });

  it("finds the /64 when the compression reaches into it", async () => {
    for (let i = 1; i <= ANONYMOUS_DAILY_LIMIT; i += 1) {
      await upload(png(), `2001:db8:0:0:${i}::`);
    }
    expect((await upload(png(), "2001:db8::9")).status).toBe(429);
    expect((await upload(png(), "2001:db8:0:1::9")).status).toBe(201);
  });

  it("treats an IPv4 address in IPv6 form as the IPv4 address", async () => {
    for (let i = 0; i < ANONYMOUS_DAILY_LIMIT; i += 1) await upload();
    expect((await upload(png(), "::ffff:203.0.113.7")).status).toBe(429);
  });

  it("lets simultaneous uploads take only the places left", async () => {
    const results = await Promise.all(
      Array.from({ length: ANONYMOUS_DAILY_LIMIT + 3 }, () => upload()),
    );
    const accepted = results.filter((r) => r.status === 201);
    expect(accepted).toHaveLength(ANONYMOUS_DAILY_LIMIT);
  });

  it("starts again the next UTC day", async () => {
    for (let i = 0; i < ANONYMOUS_DAILY_LIMIT; i += 1) await upload();
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

    const owner = await env.DB.prepare("SELECT count FROM usage WHERE key != 'global'").first<{
      count: number;
    }>();
    expect(owner?.count).toBe(0);
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

describe("routing", () => {
  it("shows where to report a capture", async () => {
    const response = await call("/");
    expect(await response.text()).toContain(env.ABUSE_CONTACT);
  });

  it("keeps robots away", async () => {
    expect(await (await call("/robots.txt")).text()).toContain("Disallow: /");
  });

  it("refuses the wrong methods and unknown paths", async () => {
    expect((await call("/v1/captures")).status).toBe(405);
    expect((await call(`/${"a".repeat(22)}.png`, { method: "POST" })).status).toBe(405);
    expect((await call("/../etc/passwd")).status).toBe(404);
    expect((await call("/short.png")).status).toBe(404);
  });
});
