import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  ACCOUNT_BLOCK_DAILY_LIMIT,
  BLOCK_DAILY_CODES,
  EMAIL_DAILY_CODES,
  GLOBAL_DAILY_CODES,
  LOGIN_CODE_ATTEMPTS,
  LOGIN_CODE_LIFETIME_MS,
  PLANS,
  SESSION_LIFETIME_MS,
} from "../src/limits";
import { codeEmail } from "../src/mail";
import { purgeExpired, utcDay } from "../src/store";

const BASE = "https://i.snap2link.app";
const GUEST = "guest-token-of-the-account-tests";
const EMAIL = "someone@example.com";
const IP = "203.0.113.7";
const FREE = PLANS.free;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const storage = { db: env.DB, images: env.IMAGES };

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function png(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(SIGNATURE);
  return bytes;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request(`${BASE}${path}`, init) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(request, env);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path: string, body: unknown, token = GUEST, ip = IP): Promise<Response> {
  return call(path, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "CF-Connecting-IP": ip, Authorization: `Bearer ${token}` },
  });
}

function upload(token: string, ip = IP): Promise<Response> {
  const body = png();
  return call("/v1/captures", {
    method: "POST",
    body,
    headers: {
      "CF-Connecting-IP": ip,
      Authorization: `Bearer ${token}`,
      "Content-Length": String(body.byteLength),
    },
  });
}

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Every email Resend was asked to send, once the app's call has answered. */
function resendAnswers(status = 200) {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status });
  });
  return { sent, spy };
}

/** Asks for a code and returns it, as read from the email. */
async function askCode(email = EMAIL, ip = IP): Promise<string> {
  const { sent, spy } = resendAnswers();
  const answer = await post("/v1/login/code", { email }, GUEST, ip);
  spy.mockRestore();
  expect(answer.status).toBe(202);
  return /\n(\d{6})\n/.exec(sent[0].text)![1];
}

interface Signed {
  session_token: string;
  email: string;
  plan: string;
}

async function signIn(email = EMAIL, ip = IP): Promise<Signed> {
  const code = await askCode(email, ip);
  const answer = await post("/v1/login/verify", { email, code }, GUEST, ip);
  expect(answer.status).toBe(200);
  return answer.json<Signed>();
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const storedBytes = async () =>
  (await env.DB.prepare("SELECT value FROM stats WHERE key = 'stored_bytes'").first<{
    value: number;
  }>())!.value;

beforeEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const { objects } = await env.IMAGES.list();
  if (objects.length > 0) await env.IMAGES.delete(objects.map(({ key }) => key));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM captures"),
    env.DB.prepare("DELETE FROM guests"),
    env.DB.prepare("DELETE FROM usage"),
    env.DB.prepare("DELETE FROM accounts"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM login_codes"),
    env.DB.prepare("UPDATE stats SET value = 0"),
    env.DB.prepare(
      "INSERT INTO guests (token_hash, created_at, expires_at) VALUES (?1, 0, ?2)",
    ).bind(await sha256(GUEST), Date.now() + 60_000_000),
  ]);
});

describe("asking for a code", () => {
  it("sends the code from the configured address, and stores neither it nor the email", async () => {
    const { sent } = resendAnswers();

    const answer = await post("/v1/login/code", { email: EMAIL });

    expect(answer.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    expect(sent[0].from).toBe(env.MAIL_FROM);
    const code = /\n(\d{6})\n/.exec(sent[0].text)![1];
    expect(sent[0].subject).toContain(code);

    const row = await env.DB.prepare("SELECT * FROM login_codes").first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(EMAIL);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(await count("accounts")).toBe(0);
  });

  it("needs a valid guest, so that Turnstile stands in front of every email", async () => {
    const { sent } = resendAnswers();

    expect((await post("/v1/login/code", { email: EMAIL }, "not-a-guest")).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("refuses a banned guest", async () => {
    const { sent } = resendAnswers();
    await env.DB.prepare("UPDATE guests SET banned = 1").run();

    expect((await post("/v1/login/code", { email: EMAIL })).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it.each(["", "nobody", "a@b", "a b@example.com", "a@@example.com", `${"a".repeat(250)}@b.co`, 12])(
    "refuses %s as an address",
    async (email) => {
      const { sent } = resendAnswers();

      const answer = await post("/v1/login/code", { email });

      expect(answer.status).toBe(400);
      expect(await answer.json()).toEqual({ error: "invalid_email" });
      expect(sent).toHaveLength(0);
    },
  );

  it("refuses a body that isn't JSON, or too large", async () => {
    expect((await post("/v1/login/code", "not json")).status).toBe(400);
    expect((await post("/v1/login/code", { email: EMAIL, pad: "x".repeat(2_000) })).status).toBe(400);
  });

  it("stops at the daily limit of one address", async () => {
    resendAnswers();
    for (let i = 0; i < EMAIL_DAILY_CODES; i += 1) {
      expect((await post("/v1/login/code", { email: EMAIL })).status).toBe(202);
    }

    const answer = await post("/v1/login/code", { email: EMAIL });

    expect(answer.status).toBe(429);
    expect(await answer.json()).toEqual({ error: "daily_limit" });
  });

  it("treats two spellings of an address as one", async () => {
    resendAnswers();
    for (let i = 0; i < EMAIL_DAILY_CODES; i += 1) {
      await post("/v1/login/code", { email: EMAIL });
    }

    expect((await post("/v1/login/code", { email: ` ${EMAIL.toUpperCase()} ` })).status).toBe(429);
  });

  it("stops at the daily limit of one address block", async () => {
    resendAnswers();
    for (let i = 0; i < BLOCK_DAILY_CODES; i += 1) {
      expect((await post("/v1/login/code", { email: `user${i}@example.com` })).status).toBe(202);
    }

    expect((await post("/v1/login/code", { email: "more@example.com" })).status).toBe(429);
    expect((await post("/v1/login/code", { email: "more@example.com" }, GUEST, "198.51.100.1")).status).toBe(202);
  });

  it("stays under Resend's daily quota, whoever asks", async () => {
    resendAnswers();
    await env.DB.prepare("INSERT INTO usage (key, day, count) VALUES ('global-codes', ?1, ?2)")
      .bind(utcDay(Date.now()), GLOBAL_DAILY_CODES)
      .run();

    const answer = await post("/v1/login/code", { email: EMAIL });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "service_busy" });
  });

  it("forgets the code and gives the quotas back when Resend refuses", async () => {
    const { sent } = resendAnswers(500);

    const answer = await post("/v1/login/code", { email: EMAIL });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "mail_unavailable" });
    expect(sent).toHaveLength(1);
    expect(await count("login_codes")).toBe(0);
    const { n } = (await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage").first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it("answers mail_unavailable when Resend can't be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));

    const answer = await post("/v1/login/code", { email: EMAIL });

    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: "mail_unavailable" });
  });

  it("never logs the address", async () => {
    resendAnswers(500);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await post("/v1/login/code", { email: EMAIL });

    expect(JSON.stringify(logged.mock.calls)).not.toContain(EMAIL);
  });

  it("writes in the language asked for, and in English otherwise", () => {
    expect(codeEmail("123456", "fr").subject).toBe("Votre code Snap2Link : 123456");
    expect(codeEmail("123456", "xx").subject).toBe("Your Snap2Link code: 123456");
    expect(codeEmail("123456", "constructor").subject).toBe("Your Snap2Link code: 123456");
    expect(codeEmail("123456", 7).subject).toBe("Your Snap2Link code: 123456");
  });

  it("has an email for every language of the app", async () => {
    for (const language of [
      "ar", "de", "en", "es", "fa", "fr", "he", "hi", "id", "it",
      "ja", "ko", "pl", "pt-BR", "ru", "tr", "uk", "vi", "zh-CN", "zh-TW",
    ]) {
      const { subject, text } = codeEmail("123456", language);
      expect(subject).toContain("123456");
      expect(text).toContain("123456");
      if (language !== "en") expect(subject).not.toBe("Your Snap2Link code: 123456");
    }
  });
});

describe("using a code", () => {
  it("creates the account and opens a session", async () => {
    const signed = await signIn();

    expect(signed.session_token).toMatch(/^s_[0-9a-f]{64}$/);
    expect(signed.email).toBe(EMAIL);
    expect(signed.plan).toBe("free");
    expect(await count("accounts")).toBe(1);
    expect(await count("login_codes")).toBe(0);

    const session = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(session!.token_hash).toBe(await sha256(signed.session_token));
  });

  it("finds the same account the next time", async () => {
    await signIn();
    const second = await signIn(EMAIL.toUpperCase());

    expect(second.email).toBe(EMAIL);
    expect(await count("accounts")).toBe(1);
    expect(await count("sessions")).toBe(2);
  });

  it("works only once", async () => {
    const code = await askCode();

    expect((await post("/v1/login/verify", { email: EMAIL, code })).status).toBe(200);
    expect((await post("/v1/login/verify", { email: EMAIL, code })).status).toBe(400);
  });

  it("is refused for another address", async () => {
    const code = await askCode();

    const answer = await post("/v1/login/verify", { email: "other@example.com", code });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ error: "invalid_code" });
    expect(await count("accounts")).toBe(0);
  });

  it("dies after too many wrong guesses, even when the right one comes last", async () => {
    const code = await askCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < LOGIN_CODE_ATTEMPTS; i += 1) {
      expect((await post("/v1/login/verify", { email: EMAIL, code: wrong })).status).toBe(400);
    }

    expect((await post("/v1/login/verify", { email: EMAIL, code })).status).toBe(400);
    expect(await count("accounts")).toBe(0);
  });

  it("is replaced by the next code", async () => {
    const first = await askCode();
    const second = await askCode();

    if (first !== second) {
      expect((await post("/v1/login/verify", { email: EMAIL, code: first })).status).toBe(400);
    }
    expect((await post("/v1/login/verify", { email: EMAIL, code: second })).status).toBe(200);
  });

  it("expires", async () => {
    const code = await askCode();
    vi.useFakeTimers({ now: Date.now() + LOGIN_CODE_LIFETIME_MS + 1, toFake: ["Date"] });

    expect((await post("/v1/login/verify", { email: EMAIL, code })).status).toBe(400);
  });

  it("needs a guest", async () => {
    const code = await askCode();

    expect((await post("/v1/login/verify", { email: EMAIL, code }, "not-a-guest")).status).toBe(401);
  });

  it("refuses a banned account, and opens no session for it", async () => {
    await signIn();
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET banned = 1"),
      env.DB.prepare("DELETE FROM sessions"),
    ]);
    const code = await askCode();

    const answer = await post("/v1/login/verify", { email: EMAIL, code });

    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: "account_banned" });
    expect(await count("sessions")).toBe(0);
  });

  it.each([
    [{ email: EMAIL }],
    [{ code: "123456" }],
    [{ email: "nobody", code: "123456" }],
    [{ email: EMAIL, code: 123456 }],
  ])("refuses %j", async (body) => {
    expect((await post("/v1/login/verify", body)).status).toBe(400);
  });
});

describe("an account's captures", () => {
  it("are not limited like a guest's", async () => {
    const { session_token } = await signIn();

    for (let i = 0; i < FREE.dailyCaptures; i += 1) {
      expect((await upload(session_token)).status).toBe(201);
    }
  });

  it("stop at the plan's daily limit", async () => {
    const { session_token } = await signIn();
    for (let i = 0; i < FREE.dailyCaptures; i += 1) await upload(session_token);

    const answer = await upload(session_token);

    expect(answer.status).toBe(429);
    expect(await answer.json()).toEqual({ error: "daily_limit" });
  });

  it("stop at the limit of the address block, but leave its guests alone", async () => {
    const { session_token } = await signIn();
    expect((await upload(session_token)).status).toBe(201);
    await env.DB.prepare("UPDATE usage SET count = ?1 WHERE key LIKE 'account-ip:%'")
      .bind(ACCOUNT_BLOCK_DAILY_LIMIT)
      .run();

    expect((await upload(session_token)).status).toBe(429);
    expect((await upload(GUEST)).status).toBe(201);
  });

  it("keep the newest links alive and end the oldest", async () => {
    const { session_token } = await signIn();
    const urls: string[] = [];
    for (let i = 0; i < FREE.slots + 2; i += 1) {
      const { url } = await (await upload(session_token)).json<{ url: string }>();
      urls.push(new URL(url).pathname);
    }

    const alive = await Promise.all(urls.map(async (url) => (await call(url)).status));

    expect(alive.slice(0, 2)).toEqual([404, 404]);
    expect(alive.slice(2)).toEqual(Array(FREE.slots).fill(200));
  });

  it("free the space of an ended link at the next cleanup", async () => {
    const { session_token } = await signIn();
    for (let i = 0; i < FREE.slots + 1; i += 1) await upload(session_token);
    expect((await env.IMAGES.list()).objects).toHaveLength(FREE.slots + 1);

    expect(await purgeExpired(storage, Date.now() + 1)).toBe(1);

    expect((await env.IMAGES.list()).objects).toHaveLength(FREE.slots);
    expect(await storedBytes()).toBe(png().byteLength * FREE.slots);
  });

  it("don't touch another account's links", async () => {
    const one = await signIn("one@example.com");
    const two = await signIn("two@example.com");
    const { url } = await (await upload(one.session_token)).json<{ url: string }>();

    for (let i = 0; i < FREE.slots + 1; i += 1) await upload(two.session_token);

    expect((await call(new URL(url).pathname)).status).toBe(200);
  });

  it("can't be sent with an unknown session, and that doesn't fall back to a guest", async () => {
    const answer = await upload("s_unknown");

    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({ error: "session_required" });
  });

  it("can't be sent once the account is banned", async () => {
    const { session_token } = await signIn();
    await env.DB.prepare("UPDATE accounts SET banned = 1").run();

    const answer = await upload(session_token);

    expect(answer.status).toBe(403);
    expect(await answer.json()).toEqual({ error: "account_banned" });
  });

  it("keep working for guests as before", async () => {
    const answer = await upload(GUEST);

    expect(answer.status).toBe(201);
    const row = await env.DB.prepare("SELECT guest_hash, account_id FROM captures").first<{
      guest_hash: string;
      account_id: string | null;
    }>();
    expect(row!.guest_hash).toBe(await sha256(GUEST));
    expect(row!.account_id).toBeNull();
  });
});

describe("/v1/me", () => {
  it("tells what the account has used", async () => {
    const { session_token } = await signIn();
    await upload(session_token);
    await upload(session_token);

    const answer = await call("/v1/me", bearer(session_token));

    expect(await answer.json()).toEqual({
      email: EMAIL,
      plan: "free",
      captures_today: 2,
      daily_captures: FREE.dailyCaptures,
      slots_used: 2,
      slots: FREE.slots,
    });
  });

  it("counts only the links that still work", async () => {
    const { session_token } = await signIn();
    for (let i = 0; i < FREE.slots + 3; i += 1) await upload(session_token);

    const me = await (await call("/v1/me", bearer(session_token))).json<{
      captures_today: number;
      slots_used: number;
    }>();

    expect(me.captures_today).toBe(FREE.slots + 3);
    expect(me.slots_used).toBe(FREE.slots);
  });

  it("refuses a guest token and an expired session", async () => {
    const { session_token } = await signIn();

    expect((await call("/v1/me", bearer(GUEST))).status).toBe(401);
    vi.useFakeTimers({ now: Date.now() + SESSION_LIFETIME_MS + 1, toFake: ["Date"] });
    expect((await call("/v1/me", bearer(session_token))).status).toBe(401);
  });
});

describe("leaving", () => {
  it("signing out ends only this session", async () => {
    const one = await signIn();
    const two = await signIn();

    const answer = await call("/v1/logout", { method: "POST", ...bearer(one.session_token) });

    expect(answer.status).toBe(204);
    expect((await call("/v1/me", bearer(one.session_token))).status).toBe(401);
    expect((await call("/v1/me", bearer(two.session_token))).status).toBe(200);
  });

  it("deleting the account removes everything it had", async () => {
    const { session_token } = await signIn();
    const { url } = await (await upload(session_token)).json<{ url: string }>();
    await upload(GUEST);

    const answer = await call("/v1/me", { method: "DELETE", ...bearer(session_token) });

    expect(answer.status).toBe(204);
    expect((await call(new URL(url).pathname)).status).toBe(404);
    expect(await count("accounts")).toBe(0);
    expect(await count("sessions")).toBe(0);
    expect(await count("captures")).toBe(1);
    expect((await env.IMAGES.list()).objects).toHaveLength(1);
    expect(await storedBytes()).toBe(png().byteLength);
  });

  it("deleting and coming back doesn't reset the day's quota", async () => {
    const first = await signIn();
    for (let i = 0; i < FREE.dailyCaptures; i += 1) await upload(first.session_token);
    await call("/v1/me", { method: "DELETE", ...bearer(first.session_token) });

    const second = await signIn();

    expect((await upload(second.session_token)).status).toBe(429);
  });

  it("the cleanup forgets accounts left unused, but not the others", async () => {
    await signIn("gone@example.com");
    await signIn("banned@example.com");
    await signIn("paying@example.com");
    const kept = await signIn("kept@example.com");
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET banned = 1 WHERE email = 'banned@example.com'"),
      env.DB.prepare("UPDATE accounts SET plan = 'starter' WHERE email = 'paying@example.com'"),
      env.DB.prepare("UPDATE sessions SET expires_at = 0 WHERE token_hash != ?1").bind(
        await sha256(kept.session_token),
      ),
    ]);

    await purgeExpired(storage, Date.now() + SESSION_LIFETIME_MS - 1_000);
    expect(await count("accounts")).toBe(4);

    await purgeExpired(storage, Date.now() + SESSION_LIFETIME_MS + 1_000);

    const { results } = await env.DB.prepare("SELECT email FROM accounts ORDER BY email").all<{ email: string }>();
    expect(results.map(({ email }) => email)).toEqual([
      "banned@example.com",
      "paying@example.com",
    ]);
  });
});
