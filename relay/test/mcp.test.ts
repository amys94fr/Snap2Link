import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  MAX_DRIVE_BYTES,
  MAX_INLINE_BYTES,
  MAX_MCP_REQUEST_BYTES,
  MCP_BLOCK_DAILY_LIMIT,
  MCP_DAILY_LIMIT,
  MCP_IMAGE_SIDE,
} from "../src/limits";
import { utcDay } from "../src/store";

const BASE = "https://i.snap2link.app";
const ID = "4fGh2kLm9PqRs7TuVw1XyZ";
const DRIVE = "https://drive.google.com/uc?id=abc_123&export=download";
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(SIGNATURE);
  return bytes;
}

async function store(id: string, bytes: Uint8Array<ArrayBuffer>, expiresAt = Date.now() + 60_000) {
  await env.IMAGES.put(id, bytes);
  await env.DB.prepare(
    `INSERT INTO captures (id, delete_hash, guest_hash, size, created_at, expires_at)
     VALUES (?1, 'hash', 'guest', ?2, 0, ?3)`,
  )
    .bind(id, bytes.byteLength, expiresAt)
    .run();
}

function post(message: unknown, bindings: Partial<typeof env> = {}): Promise<Response> {
  const request = new Request(`${BASE}/mcp`, {
    method: "POST",
    body: typeof message === "string" ? message : JSON.stringify(message),
  }) as Parameters<typeof worker.fetch>[0];
  return worker.fetch(request, { ...env, ...bindings });
}

const rpc = async (method: string, params?: object, bindings?: Partial<typeof env>) =>
  (await post({ jsonrpc: "2.0", id: 1, method, params }, bindings)).json<{
    result: { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
    error?: { code: number };
  }>();

const read = (url: string, bindings?: Partial<typeof env>) =>
  rpc("tools/call", { name: "read_capture", arguments: { url } }, bindings);

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
        return { image: () => new Response("small").body };
      },
    }),
  } as unknown as ImagesBinding;
  return { asked, binding };
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM captures"), env.DB.prepare("DELETE FROM usage")]);
  const { objects } = await env.IMAGES.list();
  if (objects.length > 0) await env.IMAGES.delete(objects.map(({ key }) => key));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the protocol", () => {
  it("introduces itself with the version the client knows", async () => {
    const reply = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "snap2link" },
    });
  });

  it("offers its latest version for one it doesn't know", async () => {
    const reply = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(reply.result).toMatchObject({ protocolVersion: "2025-11-25" });
  });

  it("lists its tool as read-only", async () => {
    const reply = await rpc("tools/list");
    expect(reply.result).toMatchObject({
      tools: [{ name: "read_capture", annotations: { readOnlyHint: true, destructiveHint: false } }],
    });
  });

  it("accepts notifications without an answer", async () => {
    const response = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("offers no stream and no session", async () => {
    for (const method of ["GET", "DELETE"]) {
      const request = new Request(`${BASE}/mcp`, { method }) as Parameters<typeof worker.fetch>[0];
      const response = await worker.fetch(request, env);
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    }
  });

  it("refuses what isn't JSON, an oversized body and an unknown method", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post("x".repeat(20_000))).status).toBe(413);
    expect((await rpc("resources/list")).error?.code).toBe(-32601);
  });

  it("refuses a body past the limit even when it declares no size", async () => {
    const body = new Blob([new Uint8Array(MAX_MCP_REQUEST_BYTES + 1)]).stream();
    const request = new Request(`${BASE}/mcp`, { method: "POST", body });
    request.headers.delete("Content-Length");
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
    expect(response.status).toBe(413);
  });

  it("refuses requests from web pages", async () => {
    const request = new Request(`${BASE}/mcp`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }) as Parameters<typeof worker.fetch>[0];
    expect((await worker.fetch(request, env)).status).toBe(403);
  });

  it("refuses an unknown tool and a missing link", async () => {
    expect((await rpc("tools/call", { name: "other" })).error?.code).toBe(-32602);
    expect((await rpc("tools/call", { name: "read_capture" })).error?.code).toBe(-32602);
  });
});

describe("reading a capture on the relay", () => {
  it.each([
    ["the short link", `${BASE}/${ID}`],
    ["the link with .png", `${BASE}/${ID}.png`],
  ])("returns the image for %s", async (_, url) => {
    const image = png();
    await store(ID, image);
    const { result } = await read(url);
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    const bytes = Uint8Array.from(atob(result.content[0].data ?? ""), (c) => c.charCodeAt(0));
    expect(bytes).toEqual(image);
  });

  it("says when a capture has expired", async () => {
    await store(ID, png(), Date.now() - 1);
    const { result } = await read(`${BASE}/${ID}`);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("expired");
  });

  it("refuses a stored file that isn't a PNG", async () => {
    await store(ID, new Uint8Array(64));
    const { result } = await read(`${BASE}/${ID}`);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not a PNG");
  });

  it("reduces a large capture", async () => {
    await store(ID, png(MAX_INLINE_BYTES + 1));
    const { asked, binding } = resizer("resizes");
    const { result } = await read(`${BASE}/${ID}`, { RESIZER: binding });
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg", data: btoa("small") });
    expect(asked).toEqual([{ width: MCP_IMAGE_SIDE, height: MCP_IMAGE_SIDE, fit: "scale-down" }]);
  });

  it("answers with an error when the resizer refuses", async () => {
    await store(ID, png(MAX_INLINE_BYTES + 1));
    const { result } = await read(`${BASE}/${ID}`, { RESIZER: resizer("refuses").binding });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("open the link yourself");
  });
});

describe("which links it accepts", () => {
  it.each([
    ["another host", "https://evil.example/capture.png"],
    ["a local address", "https://127.0.0.1/capture.png"],
    ["plain http", `http://i.snap2link.app/${ID}`],
    ["a lookalike host", `https://i.snap2link.app.evil.example/${ID}`],
    ["a short id", `${BASE}/abc`],
    ["a path", `${BASE}/v1/${ID}`],
    ["a query", `${BASE}/${ID}?a=1`],
    ["another Drive link", "https://drive.google.com/file/d/abc/view"],
  ])("refuses %s without any download", async (_, url) => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const { result } = await read(url);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not a Snap2Link link");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("reading a capture on Drive", () => {
  const redirect = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

  it("follows redirects between Drive hosts", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirect("https://drive.usercontent.google.com/download?id=abc"))
      .mockResolvedValueOnce(new Response(png()));
    const { result } = await read(DRIVE);
    expect(result.content[0].type).toBe("image");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["another host", "https://evil.example/x.png"],
    ["a local address", "https://127.0.0.1/x.png"],
    ["plain http", "http://drive.usercontent.google.com/x.png"],
  ])("refuses a redirect to %s", async (_, target) => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(redirect(target));
    const { result } = await read(DRIVE);
    expect(result.isError).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops after too many redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => redirect(DRIVE));
    const { result } = await read(DRIVE);
    expect(result.content[0].text).toContain("Too many redirects");
  });

  it("refuses a file that declares too large a size", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("x", { headers: { "Content-Length": String(MAX_DRIVE_BYTES + 1) } }),
    );
    const { result } = await read(DRIVE);
    expect(result.content[0].text).toContain("too large");
  });

  it("refuses a file that turns out too large", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(MAX_DRIVE_BYTES + 1)));
    const { result } = await read(DRIVE);
    expect(result.content[0].text).toContain("too large");
  });

  it("refuses a page that isn't an image", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>"));
    const { result } = await read(DRIVE);
    expect(result.content[0].text).toContain("not a PNG");
  });

  it("says when the host refuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result } = await read(DRIVE);
    expect(result.content[0].text).toContain("404");
  });
});

describe("the daily limit", () => {
  it("stops one address block without stopping the others", async () => {
    await store(ID, png());
    const from = (ip: string) => {
      const request = new Request(`${BASE}/mcp`, {
        method: "POST",
        headers: { "CF-Connecting-IP": ip },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "read_capture", arguments: { url: `${BASE}/${ID}` } },
        }),
      }) as Parameters<typeof worker.fetch>[0];
      return worker
        .fetch(request, env)
        .then((response) => response.json<{ result: { isError?: boolean } }>());
    };

    await from("203.0.113.7");
    await env.DB.prepare("UPDATE usage SET count = ?1 WHERE key LIKE 'mcp-%'")
      .bind(MCP_BLOCK_DAILY_LIMIT)
      .run();

    expect((await from("203.0.113.7")).result.isError).toBe(true);
    expect((await from("198.51.100.7")).result.isError).toBeUndefined();
  });

  it("stops reading past it, and doesn't count refused links", async () => {
    await store(ID, png());
    await read("https://evil.example/capture.png");
    const usage = () =>
      env.DB.prepare("SELECT count FROM usage WHERE key = 'mcp'").first<{ count: number }>();
    expect(await usage()).toBeNull();

    await read(`${BASE}/${ID}`);
    expect((await usage())?.count).toBe(1);

    await env.DB.prepare("UPDATE usage SET count = ?1, day = ?2 WHERE key = 'mcp'")
      .bind(MCP_DAILY_LIMIT, utcDay(Date.now()))
      .run();
    const { result } = await read(`${BASE}/${ID}`);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("busy");
  });
});
