import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { BLOCK_DAILY_GOOGLE } from "../src/limits";

const BASE = "https://i.snap2link.app";
const GUEST = "guest-token-of-the-google-tests";
const IP = "203.0.113.7";
const EMAIL = "someone@gmail.com";

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};

let keys: CryptoKeyPair;
let otherKeys: CryptoKeyPair;
let publicJwk: JsonWebKey;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const text = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

const seconds = () => Math.floor(Date.now() / 1000);

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: env.GOOGLE_CLIENT_ID,
    iat: seconds(),
    exp: seconds() + 3600,
    email: EMAIL,
    email_verified: true,
    ...overrides,
  };
}

async function token(
  payload: Record<string, unknown> = claims(),
  { header = { alg: "RS256", kid: "key-1" }, key = keys.privateKey } = {},
): Promise<string> {
  const content = `${text(header)}.${text(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return `${content}.${base64url(new Uint8Array(signature))}`;
}

function googleAnswers(status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ keys: [{ ...publicJwk, kid: "key-1", alg: "RS256", use: "sig" }] }, { status }),
  );
}

async function login(idToken: unknown, guest = GUEST): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request(`${BASE}/v1/login/google`, {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
    headers: { "CF-Connecting-IP": IP, Authorization: `Bearer ${guest}` },
  }) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(request, env);
  await waitOnExecutionContext(ctx);
  return response;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKeys = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM guests"),
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("INSERT INTO guests (token_hash, created_at, expires_at) VALUES (?1, 0, ?2)").bind(
      await sha256(GUEST),
      Date.now() + 60_000_000,
    ),
  ]);
  googleAnswers();
});

describe("signing in with Google", () => {
  it("creates the account and opens a session", async () => {
    const answer = await login(await token());

    expect(answer.status).toBe(200);
    const body = await answer.json<{ session_token: string; email: string; plan: string }>();
    expect(body.session_token).toMatch(/^s_[0-9a-f]{64}$/);
    expect(body.email).toBe(EMAIL);
    expect(body.plan).toBe("free");
    expect(await count("accounts")).toBe(1);
  });

  it("finds the same account the next time, whatever the case of the address", async () => {
    await login(await token());
    await login(await token(claims({ email: EMAIL.toUpperCase() })));

    expect(await count("accounts")).toBe(1);
    expect(await count("sessions")).toBe(2);
  });

  it("accepts a token made for the Web client, as Android's Credential Manager gets", async () => {
    expect((await login(await token(claims({ aud: env.GOOGLE_WEB_CLIENT_ID })))).status).toBe(200);
  });

  it("accepts Google's short issuer too", async () => {
    expect((await login(await token(claims({ iss: "accounts.google.com" })))).status).toBe(200);
  });

  it.each([
    ["for another client", { aud: "someone-elses-client" }],
    ["from another issuer", { iss: "https://evil.example" }],
    ["expired", { exp: 1 }],
    ["without an expiry", { exp: undefined }],
    ["issued too long ago", { iat: 1 }],
    ["issued in the future", { iat: 9_999_999_999 }],
    ["with an unverified address", { email_verified: false }],
    ["with \"true\" as a string", { email_verified: "true" }],
    ["without an address", { email: undefined }],
    ["with something that isn't an address", { email: "nobody" }],
  ])("refuses a token %s", async (_name, overrides) => {
    const answer = await login(await token(claims(overrides)));

    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: "google_refused" });
    expect(await count("accounts")).toBe(0);
  });

  it("refuses a token signed by anyone else", async () => {
    const answer = await login(await token(claims(), { key: otherKeys.privateKey }));

    expect(answer.status).toBe(403);
    expect(await count("accounts")).toBe(0);
  });

  it("refuses a token whose content was changed after signing", async () => {
    const [head, , signature] = (await token()).split(".");
    const forged = `${head}.${text(claims({ email: "victim@gmail.com" }))}.${signature}`;

    expect((await login(forged)).status).toBe(403);
    expect(await count("accounts")).toBe(0);
  });

  it("doesn't let a token choose how it is checked", async () => {
    const unsigned = `${text({ alg: "none", kid: "key-1" })}.${text(claims())}.`;

    expect((await login(unsigned)).status).toBe(403);
    expect((await login(await token(claims(), { header: { alg: "HS256", kid: "key-1" } }))).status).toBe(403);
  });

  it("refuses an unknown key", async () => {
    const answer = await login(await token(claims(), { header: { alg: "RS256", kid: "unknown" } }));

    expect(answer.status).toBe(403);
  });

  it.each(["", "a.b", "a.b.c", "not a token", "....."])("refuses %j", async (value) => {
    expect((await login(value)).status).toBe(403);
  });

  it("asks to retry when Google's keys can't be reached", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    const answer = await login(await token(claims(), { header: { alg: "RS256", kid: "new-key" } }));

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "service_busy" });
  });

  it("needs a guest, so that Turnstile stands in front", async () => {
    expect((await login(await token(), "not-a-guest")).status).toBe(401);
    expect(await count("accounts")).toBe(0);
  });

  it("refuses a body without a token", async () => {
    expect((await login(12)).status).toBe(400);
  });

  it("stops at the daily limit of an address block", async () => {
    for (let i = 0; i < BLOCK_DAILY_GOOGLE; i += 1) await login("a.b.c");

    const answer = await login(await token());

    expect(answer.status).toBe(429);
    expect(await count("accounts")).toBe(0);
  });

  it("refuses a banned account", async () => {
    await login(await token());
    await env.DB.prepare("UPDATE accounts SET banned = 1").run();

    const answer = await login(await token());

    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: "account_banned" });
    expect(await count("sessions")).toBe(1);
  });
});

describe("Google on the website", () => {
  function webLogin(credential: unknown, origin = "https://snap2link.app"): Promise<Response> {
    const request = new Request(`${BASE}/v1/web/login/google`, {
      method: "POST",
      body: JSON.stringify({ credential }),
      headers: { "CF-Connecting-IP": IP, Origin: origin, "Content-Type": "application/json" },
    }) as Parameters<typeof worker.fetch>[0];
    return worker.fetch(request, env);
  }

  it("signs in with a token made for the website's client, in a cookie", async () => {
    googleAnswers();

    const answer = await webLogin(await token(claims({ aud: env.GOOGLE_WEB_CLIENT_ID })));

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(await answer.json()).toEqual({ email: EMAIL, plan: "free" });
    expect(await env.DB.prepare("SELECT kind FROM sessions").first<{ kind: string }>()).toEqual({ kind: "web" });
  });

  it("refuses a token made for the app", async () => {
    googleAnswers();

    const answer = await webLogin(await token(claims()));

    expect(answer.status).toBe(403);
    expect(answer.headers.get("Set-Cookie")).toBeNull();
  });

  it("joins the account of the same address", async () => {
    googleAnswers();
    await login(await token());

    await webLogin(await token(claims({ aud: env.GOOGLE_WEB_CLIENT_ID })));

    expect(await count("accounts")).toBe(1);
    expect(await count("sessions")).toBe(2);
  });

  it("counts against the same daily limit as the app", async () => {
    googleAnswers();
    const credential = await token(claims({ aud: env.GOOGLE_WEB_CLIENT_ID }));
    for (let i = 0; i < BLOCK_DAILY_GOOGLE; i += 1) await webLogin(credential);

    expect((await webLogin(credential)).status).toBe(429);
  });
});
