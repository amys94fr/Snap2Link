import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const BASE = "https://i.snap2link.app";
const SITE = "https://snap2link.app";
const IP = "203.0.113.20";
const EMAIL = "web@example.com";

interface Call {
  method?: string;
  body?: unknown;
  origin?: string | null;
  cookie?: string;
  token?: string;
}

function call(path: string, { method = "GET", body, origin = SITE, cookie, token }: Call = {}) {
  const headers = new Headers({ "CF-Connecting-IP": IP });
  if (origin) headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
}

/** Answers Turnstile and Resend, and keeps the codes the emails carried. */
function services(turnstile: { success: boolean; hostname?: string; action?: string }) {
  const codes: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("turnstile")) return Response.json(turnstile);
    codes.push(/\n(\d{6})\n/.exec(JSON.parse(String(init?.body)).text)![1]);
    return new Response("{}");
  });
  return { codes, spy };
}

const PASSED = { success: true, hostname: "snap2link.app", action: "web_login" };

/** Signs in through the website and returns the session cookie. */
async function signIn(email = EMAIL): Promise<string> {
  const { codes, spy } = services(PASSED);
  expect((await call("/v1/web/login/code", { method: "POST", body: { email, turnstile: "ok" } })).status).toBe(202);
  spy.mockRestore();
  const answer = await call("/v1/web/login/verify", { method: "POST", body: { email, code: codes[0] } });
  expect(answer.status).toBe(200);
  return /^(s2l_session=[^;]+)/.exec(answer.headers.get("Set-Cookie")!)![1];
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM captures"),
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM login_codes"),
  ]);
});

describe("signing in on the website", () => {
  it("sets a session cookie the page's script can't read, only sent from the site", async () => {
    const { codes } = services(PASSED);
    await call("/v1/web/login/code", { method: "POST", body: { email: EMAIL, turnstile: "ok" } });
    const answer = await call("/v1/web/login/verify", { method: "POST", body: { email: EMAIL, code: codes[0] } });

    const cookie = answer.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 3600}`);
    expect(await answer.json()).not.toHaveProperty("session_token");
  });

  it("needs Turnstile, made for the site", async () => {
    const send = (turnstile: unknown) =>
      call("/v1/web/login/code", { method: "POST", body: { email: EMAIL, turnstile } });

    expect((await send(undefined)).status).toBe(400);
    services({ success: true, hostname: "i.snap2link.app", action: "guest" });
    expect((await send("from-the-guest-page")).status).toBe(403);
  });

  it("refuses a wrong code", async () => {
    services(PASSED);
    await call("/v1/web/login/code", { method: "POST", body: { email: EMAIL, turnstile: "ok" } });

    const answer = await call("/v1/web/login/verify", { method: "POST", body: { email: EMAIL, code: "000000" } });

    expect(answer.status).toBe(400);
    expect(answer.headers.get("Set-Cookie")).toBeNull();
  });

  it("signs out and clears the cookie", async () => {
    const cookie = await signIn();

    const answer = await call("/v1/web/logout", { method: "POST", cookie });

    expect(answer.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await call("/v1/me", { cookie })).status).toBe(401);
  });
});

describe("the session cookie", () => {
  it("works from the site", async () => {
    const cookie = await signIn();
    const answer = await call("/v1/me", { cookie });

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    expect(answer.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("is ignored from any other page, or without an origin", async () => {
    const cookie = await signIn();

    const other = await call("/v1/me", { cookie, origin: "https://evil.example" });
    const none = await call("/v1/me", { cookie, origin: null });

    expect(other.status).toBe(401);
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(none.status).toBe(401);
  });

  it("can't delete the account from another page", async () => {
    const cookie = await signIn();

    await call("/v1/me", { method: "DELETE", cookie, origin: "https://evil.example" });

    expect((await call("/v1/me", { cookie })).status).toBe(200);
  });

  it("answers the browser's preflight for the site only", async () => {
    const site = await call("/v1/me", { method: "OPTIONS" });
    const other = await call("/v1/me", { method: "OPTIONS", origin: "https://evil.example" });

    expect(site.status).toBe(204);
    expect(site.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("lists the account's links like the app's session does", async () => {
    const cookie = await signIn();
    const session = await env.DB.prepare("SELECT account_id FROM sessions").first<{ account_id: string }>();
    await env.DB.prepare(
      "INSERT INTO captures (id, delete_hash, account_id, size, created_at, expires_at) VALUES ('abcdefghijklmnopqrstuv', 'x', ?1, 12, ?2, ?3)",
    ).bind(session!.account_id, Date.now(), Date.now() + 3_600_000).run();

    const { captures } = await (await call("/v1/captures", { cookie })).json<{ captures: unknown[] }>();

    expect(captures).toHaveLength(1);
  });
});

describe("the profile", () => {
  it("saves a name and a language", async () => {
    const cookie = await signIn();

    const saved = await call("/v1/me", { method: "PATCH", cookie, body: { name: "  Sam  ", language: "fr" } });
    const me = await (await call("/v1/me", { cookie })).json();

    expect(saved.status).toBe(204);
    expect(me).toMatchObject({ name: "Sam", language: "fr" });
  });

  it("refuses an unknown language or a long name", async () => {
    const cookie = await signIn();

    expect((await call("/v1/me", { method: "PATCH", cookie, body: { language: "xx" } })).status).toBe(400);
    expect((await call("/v1/me", { method: "PATCH", cookie, body: { name: "a".repeat(61) } })).status).toBe(400);
  });

  it("exports what the account holds, without any token", async () => {
    const cookie = await signIn();
    const answer = await call("/v1/me/export", { cookie });
    const text = await answer.text();

    expect(answer.headers.get("Content-Disposition")).toContain("attachment");
    expect(JSON.parse(text).account.email).toBe(EMAIL);
    expect(text).not.toMatch(/token|hash/i);
  });
});

describe("devices", () => {
  it("lists sessions and closes the others", async () => {
    const cookie = await signIn();
    await signIn();

    const sessions = await (await call("/v1/sessions", { cookie })).json<{ id: string; current: boolean }[]>();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter(({ current }) => current)).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toMatch(/token/);

    await call("/v1/sessions", { method: "DELETE", cookie });

    expect(await (await call("/v1/sessions", { cookie })).json()).toHaveLength(1);
  });

  it("closes one session, and only the account's own", async () => {
    const cookie = await signIn();
    const other = await signIn("someone-else@example.com");
    const [theirs] = await (await call("/v1/sessions", { cookie: other })).json<{ id: string }[]>();

    expect((await call(`/v1/sessions/${theirs.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await call(`/v1/sessions/${theirs.id}`, { method: "DELETE", cookie: other })).status).toBe(204);
    expect((await call("/v1/me", { cookie: other })).status).toBe(401);
  });
});

describe("changing the address", () => {
  const NEW = "new@example.com";

  async function askCode(cookie: string, email = NEW): Promise<string> {
    const { codes, spy } = services(PASSED);
    expect((await call("/v1/me/email/code", { method: "POST", cookie, body: { email } })).status).toBe(202);
    spy.mockRestore();
    return codes[0];
  }

  it("moves the account, its sessions and links to the new address", async () => {
    const cookie = await signIn();
    await call("/v1/me", { method: "PATCH", cookie, body: { name: "Sam" } });
    const code = await askCode(cookie);

    const answer = await call("/v1/me/email", { method: "PUT", cookie, body: { email: NEW, code } });

    expect(answer.status).toBe(204);
    expect(await (await call("/v1/me", { cookie })).json()).toMatchObject({ email: NEW, name: "Sam" });
    await signIn(NEW);
    const accounts = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
    expect(accounts!.n).toBe(1);
  });

  it("doesn't let the change code sign in", async () => {
    const cookie = await signIn();
    const code = await askCode(cookie);

    const answer = await call("/v1/web/login/verify", { method: "POST", body: { email: NEW, code } });

    expect(answer.status).toBe(400);
  });

  it("refuses an address that has an account", async () => {
    const cookie = await signIn();
    await signIn(NEW);
    const code = await askCode(cookie);

    const answer = await call("/v1/me/email", { method: "PUT", cookie, body: { email: NEW, code } });

    expect(answer.status).toBe(409);
  });

  it("refuses a wrong code", async () => {
    const cookie = await signIn();
    await askCode(cookie);

    expect((await call("/v1/me/email", { method: "PUT", cookie, body: { email: NEW, code: "000000" } })).status).toBe(400);
  });
});

describe("the app's token", () => {
  it("still works in the Authorization header, without an origin", async () => {
    const token = (await signIn()).split("=")[1];

    expect((await call("/v1/me", { token, origin: null })).status).toBe(200);
  });
});
