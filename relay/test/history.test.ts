import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { PLANS } from "../src/limits";

const BASE = "https://i.snap2link.app";
const GUEST = "guest-token-of-the-history-tests";
const OTHER_GUEST = "another-guest-of-the-history-tests";
const IP = "203.0.113.9";
const FREE = PLANS.free;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

interface Link {
  id: string;
  url: string;
  created_at: string;
  expires_at: string;
  pinned: boolean;
}
interface History {
  captures: Link[];
  max_pins: number;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function call(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", IP);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const request = new Request(`${BASE}${path}`, { ...init, headers });
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
}

async function upload(token: string): Promise<{ id: string; delete_token: string }> {
  const answer = await call("/v1/captures", token, {
    method: "POST",
    body: PNG,
    headers: { "Content-Length": String(PNG.byteLength) },
  });
  expect(answer.status).toBe(201);
  return answer.json();
}

const history = async (token: string) =>
  (await call("/v1/captures", token)).json<History>();

const pin = (id: string, token: string) => call(`/v1/captures/${id}/pin`, token, { method: "PUT" });

/** An account with a live session, added straight to the database. */
async function account(name: string): Promise<string> {
  const token = `s_session-of-${name}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts (id, email, created_at) VALUES (?1, ?2, ?3)",
    ).bind(name, `${name}@example.com`, now),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    ).bind(await sha256(token), name, now, now + 60_000_000),
  ]);
  return token;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  const { objects } = await env.IMAGES.list();
  if (objects.length > 0) await env.IMAGES.delete(objects.map(({ key }) => key));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM captures"),
    env.DB.prepare("DELETE FROM guests"),
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("UPDATE stats SET value = 0"),
    ...(await Promise.all(
      [GUEST, OTHER_GUEST].map(async (token) =>
        env.DB.prepare(
          "INSERT INTO guests (token_hash, created_at, expires_at) VALUES (?1, 0, ?2)",
        ).bind(await sha256(token), now + 60_000_000),
      ),
    )),
  ]);
});

describe("the history", () => {
  it("needs a guest or a session", async () => {
    expect((await call("/v1/captures", null)).status).toBe(401);
    expect((await call("/v1/captures", "nobody")).status).toBe(401);
    expect((await call("/v1/captures", "s_nobody")).status).toBe(401);
  });

  it("lists a guest's links, newest first, with no pins", async () => {
    const first = await upload(GUEST);
    const second = await upload(GUEST);

    const { captures, max_pins } = await history(GUEST);

    expect(captures.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(captures[0].url).toBe(`${BASE}/${second.id}`);
    expect(captures[0].pinned).toBe(false);
    expect(max_pins).toBe(0);
  });

  it("gives an account its plan's pins", async () => {
    expect((await history(await account("ana"))).max_pins).toBe(FREE.pins);
  });

  it("shows nobody else's links", async () => {
    const session = await account("ana");
    await upload(GUEST);
    await upload(session);

    expect((await history(OTHER_GUEST)).captures).toEqual([]);
    expect((await history(await account("ben"))).captures).toEqual([]);
    expect((await history(session)).captures).toHaveLength(1);
  });

  it("leaves out links that ended", async () => {
    const { id } = await upload(GUEST);
    await env.DB.prepare("UPDATE captures SET expires_at = 1 WHERE id = ?1").bind(id).run();

    expect((await history(GUEST)).captures).toEqual([]);
  });

  it("never gives out a delete token", async () => {
    await upload(GUEST);

    expect(JSON.stringify(await history(GUEST))).not.toContain("delete");
  });
});

describe("deleting from the history", () => {
  it("works with a guest's own token", async () => {
    const { id } = await upload(GUEST);

    const answer = await call(`/v1/captures/${id}`, GUEST, { method: "DELETE" });

    expect(answer.status).toBe(204);
    expect((await call(`/${id}`, null)).status).toBe(404);
  });

  it("works with an account's session", async () => {
    const session = await account("ana");
    const { id } = await upload(session);

    expect((await call(`/v1/captures/${id}`, session, { method: "DELETE" })).status).toBe(204);
    expect((await history(session)).captures).toEqual([]);
  });

  it("still works with the capture's delete token", async () => {
    const { id, delete_token } = await upload(GUEST);

    expect((await call(`/v1/captures/${id}`, delete_token, { method: "DELETE" })).status).toBe(204);
  });

  it("refuses someone else's capture, with the same answer as a missing one", async () => {
    const session = await account("ana");
    const { id } = await upload(GUEST);

    expect((await call(`/v1/captures/${id}`, OTHER_GUEST, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/v1/captures/${id}`, session, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/${id}`, null)).status).toBe(200);
  });
});

describe("pinning", () => {
  it("saves a pinned link when the slots are full", async () => {
    const session = await account("ana");
    const oldest = await upload(session);
    const next = await upload(session);
    expect((await pin(oldest.id, session)).status).toBe(204);

    for (let i = 0; i < FREE.slots - 1; i += 1) await upload(session);

    expect((await call(`/${oldest.id}`, null)).status).toBe(200);
    expect((await call(`/${next.id}`, null)).status).toBe(404);
  });

  it("still ends the oldest link once unpinned", async () => {
    const session = await account("ana");
    const { id } = await upload(session);
    await pin(id, session);

    const answer = await call(`/v1/captures/${id}/pin`, session, { method: "DELETE" });
    for (let i = 0; i < FREE.slots; i += 1) await upload(session);

    expect(answer.status).toBe(204);
    expect((await call(`/${id}`, null)).status).toBe(404);
  });

  it("stops at the plan's pins, so that a new capture always has a place", async () => {
    const session = await account("ana");
    const links = [];
    for (let i = 0; i < FREE.slots; i += 1) links.push(await upload(session));
    for (const { id } of links.slice(0, FREE.pins)) {
      expect((await pin(id, session)).status).toBe(204);
    }

    const refused = await pin(links[FREE.pins].id, session);
    const newest = await upload(session);

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "pin_limit" });
    expect((await call(`/${newest.id}`, null)).status).toBe(200);
    expect((await history(session)).captures).toHaveLength(FREE.slots);
  });

  it("can pin a pinned link again at the limit", async () => {
    const session = await account("ana");
    const links = [];
    for (let i = 0; i < FREE.pins; i += 1) links.push(await upload(session));
    for (const { id } of links) await pin(id, session);

    expect((await pin(links[0].id, session)).status).toBe(204);
  });

  it("doesn't extend a link", async () => {
    const session = await account("ana");
    const { id } = await upload(session);
    const before = (await history(session)).captures[0].expires_at;

    await pin(id, session);

    expect((await history(session)).captures[0]).toMatchObject({ pinned: true, expires_at: before });
  });

  it("is for accounts, and only their own links", async () => {
    const session = await account("ana");
    const guests = await upload(GUEST);
    const theirs = await upload(await account("ben"));

    expect((await pin(guests.id, GUEST)).status).toBe(401);
    expect((await pin(guests.id, session)).status).toBe(404);
    expect((await pin(theirs.id, session)).status).toBe(404);
  });
});
