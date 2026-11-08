# Snap2Link relay

Temporary image hosting for Snap2Link, so that a capture can become a link without a Google account. It runs on Cloudflare Workers, with images in R2 and quotas in D1.

The app ships no secret: anything it contained could be extracted. Each install gets a guest token instead, after passing Cloudflare Turnstile once. Quotas are enforced here, because forks can change the app.

A free account raises the limits: it takes an email address and a 6-digit code, or a Google sign-in, with no password. An account has a number of slots, the links that work at once: a new capture ends the oldest one.

## API

### `GET /guest`

The page the app opens in its own window. It runs Turnstile, then goes to `/guest/done#turnstile=<token>` or `/guest/done#error=<code>`. The app reads that navigation and keeps the token, so the page has no access to the app. The result is in the fragment, so it never reaches the server or its logs.

### `POST /v1/guests`

The body is `{"turnstile": "<token>"}`. A Turnstile token works once, for 5 minutes.

```json
{
  "guest_token": "…",
  "expires_at": "2027-02-02T18:00:00.000Z"
}
```

| Status | `error` | Meaning |
|---|---|---|
| 201 | | Created |
| 400 | `bad_request` | No token in the body |
| 403 | `verification_failed` | Turnstile refused the token |
| 429 | `daily_limit` | This address created its 10 guests of the day |
| 503 | `service_busy` | The global limit of guests is reached |
| 503 | `verification_unavailable` | Turnstile didn't answer, try again later |

### `POST /v1/captures`

Needs `Authorization: Bearer <guest_token>`, or `Bearer <session_token>` for an account. The body is the PNG itself.

```json
{
  "id": "4fGh2kLm9PqRs7TuVw1XyZ",
  "url": "https://i.snap2link.app/4fGh2kLm9PqRs7TuVw1XyZ",
  "delete_token": "…",
  "expires_at": "2026-11-04T18:00:00.000Z"
}
```

| Status | `error` | Meaning |
|---|---|---|
| 201 | | Stored |
| 401 | `guest_required` | No guest token, or an unknown or expired one: get a new one |
| 401 | `session_required` | Unknown or expired session: sign in again |
| 403 | `guest_banned` | This guest is banned |
| 403 | `account_banned` | This account is banned |
| 411 | `length_required` | No `Content-Length` |
| 413 | `too_large` | Over 5 MB |
| 415 | `not_png` | Not a PNG |
| 429 | `daily_limit` | This guest used its 5 captures of the day, this account its 20, or this address its 30 (100 through accounts) |
| 503 | `service_busy` | A global limit is reached, try again later |

### `GET /{id}`

Returns the image, or 404 once it is deleted or expired. `HEAD` works too. `/{id}.png` returns the same image, and links made before 1.8.0 use it.

WhatsApp, Facebook, X and LinkedIn get a small page with Open Graph tags instead, because they build their card from a page. They recognize themselves by their `User-Agent`, and everyone else gets the image.

### `GET /{id}.jpg`

The picture for that card. A capture up to 300 KB is served as is, and a larger one is reduced to 800 pixels on its longest side. Past Cloudflare's 5,000 free resizes of the month, larger captures answer 404 and their card has no picture: the link itself keeps working.

### `POST /mcp`

A remote MCP server with one read-only tool, `read_capture`, for the Claude plugin in `integrations/claude-code`. It is stateless and needs no account, because it only reads public links: captures on this relay and PNG files on Google Drive. A capture over 600 KB comes back reduced to 1,568 pixels on its longest side. It allows 200 reads a day per address block and 1,000 in all, then answers that it is busy. It refuses requests from web pages, recognized by their `Origin` header.

### `GET /v1/captures`

The links of a guest or an account that still work, newest first, with `Authorization: Bearer <guest or session token>`. `max_pins` is 0 for a guest: nothing replaces a guest's links.

```json
{
  "captures": [
    {
      "id": "...",
      "url": "https://i.snap2link.app/...",
      "created_at": "2026-11-06T10:00:00.000Z",
      "expires_at": "2026-11-08T10:00:00.000Z",
      "pinned": false
    }
  ],
  "max_pins": 5
}
```

### `PUT /v1/captures/{id}/pin` and `DELETE /v1/captures/{id}/pin`

Pins or unpins a link, with a session token. When the slots are full, a new capture ends the oldest unpinned link. A pin doesn't extend the link. Past the plan's pins, the answer is `409 pin_limit`.

### `DELETE /v1/captures/{id}`

Needs `Authorization: Bearer <delete_token>`. Returns 204, or 404 if the capture doesn't exist or the token is wrong.

### `POST /v1/login/code`

Needs `Authorization: Bearer <guest_token>`, so that Turnstile stands in front of every email. The body is `{"email": "…", "language": "fr"}`. The language is optional and falls back to English. The answer doesn't depend on whether the address has an account.

| Status | `error` | Meaning |
|---|---|---|
| 202 | | The code is on its way, and works for 10 minutes |
| 400 | `bad_request` | The body isn't valid |
| 400 | `invalid_email` | That can't be an address |
| 401 | `guest_required` | No valid guest token |
| 403 | `guest_banned` | This guest is banned |
| 429 | `daily_limit` | This address received 5 codes today, or this network asked for 10 |
| 503 | `service_busy` | The global limit of codes is reached |
| 503 | `mail_unavailable` | The email couldn't be sent. Nothing is counted |

### `POST /v1/login/verify`

Needs the guest token too. The body is `{"email": "…", "code": "123456"}`. This signs in, creating the account the first time. A code allows 5 guesses.

```json
{
  "session_token": "s_…",
  "expires_at": "2027-11-05T12:00:00.000Z",
  "email": "someone@example.com",
  "plan": "free"
}
```

| Status | `error` | Meaning |
|---|---|---|
| 200 | | Signed in |
| 400 | `bad_request` | The body isn't valid |
| 400 | `invalid_code` | Wrong, expired or used code |
| 401 | `guest_required` | No valid guest token |
| 403 | `account_banned` | This account is banned |

### `POST /v1/login/google`

Needs the guest token too. The body is `{"id_token": "…"}`, a Google ID token made for the app's client, less than 10 minutes old and with a verified address. It answers like `/v1/login/verify`, and an address gets the same account either way.

| Status | `error` | Meaning |
|---|---|---|
| 200 | | Signed in |
| 400 | `bad_request` | The body isn't valid |
| 401 | `guest_required` | No valid guest token |
| 403 | `google_refused` | The token isn't valid, or its address isn't verified |
| 403 | `account_banned` | This account is banned |
| 429 | `daily_limit` | This address tried 20 Google sign-ins today |
| 503 | `service_busy` | Google's keys can't be reached, try again later |

### The account area on the website

`snap2link.app/account/` uses the same routes with a session cookie instead of the `Authorization` header. The relay only reads the cookie, `HttpOnly` and `SameSite=Strict`, when the request comes from `SITE_ORIGIN`, and only answers that origin's CORS requests.

- `POST /v1/web/login/code` with `{ email, turnstile, language }`: Turnstile made for the site, with the `web_login` action.
- `POST /v1/web/login/verify` with `{ email, code }`: sets the cookie for 30 days.
- `POST /v1/web/logout`: closes the session and clears the cookie.
- `PATCH /v1/me` with `{ name?, language? }`, `GET /v1/me/export`.
- `GET /v1/sessions`, `DELETE /v1/sessions` (every other session), `DELETE /v1/sessions/{id}`.
- `POST /v1/me/email/code` with `{ email }`, then `PUT /v1/me/email` with `{ email, code }`. The code only changes the address of the account that asked: it can't sign in. The account moves to the new address with its sessions and links.

### `GET /v1/me`

Needs `Authorization: Bearer <session_token>`. Returns 401 `session_required` when the session is over.

```json
{
  "email": "someone@example.com",
  "plan": "free",
  "captures_today": 12,
  "daily_captures": 20,
  "slots_used": 4,
  "slots": 6
}
```

### `DELETE /v1/me`

Needs the session token. Deletes the account, its sessions and its captures, and returns 204.

### `POST /v1/logout`

Needs the session token. Ends this session and returns 204.

## Limits

All of them are in [`src/limits.ts`](src/limits.ts), which also explains how they keep the service inside the free tiers. Raising one can create a bill.

## Privacy

Addresses are never stored. Quotas use a hash of the address that changes every UTC day, and IPv6 addresses count per /64. A guest is a random token, kept as a hash with its dates: nothing about the device is collected. A capture keeps the hash of its guest until it expires, so that abuse can be traced to a guest and to nothing else. Images are removed at expiry, and a link stops working at that moment even if the cleanup job hasn't run.

An account stores its email address, its plan and the date it was created. An address is only stored once its code is used: until then, only a keyed hash of it exists. Codes and session tokens are stored as hashes. Resend receives the address and the code to send the email. A free account with no session left is deleted a year after it was created.

## Run it yourself

The relay is MIT, like the rest of Snap2Link. For your own instance:

1. Create a Turnstile widget for your hostname, in Managed mode. In `wrangler.jsonc`, change `routes`, `PUBLIC_URL`, `ABUSE_CONTACT`, `TURNSTILE_SITEKEY`, and the bucket and database names.
2. Create the storage, and copy the printed id into `database_id`:

   ```bash
   pnpm exec wrangler d1 create snap2link-relay
   pnpm exec wrangler r2 bucket create snap2link-relay
   pnpm exec wrangler d1 migrations apply snap2link-relay --remote
   ```

3. Set the salt to a long random value, the secret key of the widget, and a [Resend](https://resend.com) API key for a domain of yours, with `MAIL_FROM` changed in `wrangler.jsonc`. Google sign-in needs your own OAuth client in `GOOGLE_CLIENT_ID`. Account ids derive from the salt: changing it later orphans every account.

   ```bash
   pnpm exec wrangler secret put IP_SALT
   pnpm exec wrangler secret put TURNSTILE_SECRET
   pnpm exec wrangler secret put RESEND_API_KEY
   ```

4. Deploy, then add a rate limiting rule on the hostname in the Cloudflare dashboard. A rule stops a single source before it reaches the Worker. Workers quotas are per account, so a flood here can affect your other Workers.

   ```bash
   pnpm exec wrangler deploy
   ```

## Deployment of snap2link.app

GitHub Actions deploys `main` after the tests pass (`.github/workflows/relay.yml`). It applies new migrations first, then deploys. The token is the `CLOUDFLARE_API_TOKEN` secret of the `relay` environment, which only `main` can use. It needs the "Edit Cloudflare Workers" template plus D1 Edit.

## Taking a capture down

To also ban the guest that sent it, do this first, while the capture still exists:

```bash
pnpm exec wrangler d1 execute snap2link-relay --remote --command "UPDATE guests SET banned = 1 WHERE token_hash = (SELECT guest_hash FROM captures WHERE id = '<id>')"
```

Then remove the capture:

```bash
pnpm exec wrangler r2 object delete snap2link-relay/<id> --remote
pnpm exec wrangler d1 execute snap2link-relay --remote --command "DELETE FROM captures WHERE id = '<id>'"
```

The space comes back through `stats`, which drifts by the size of that capture until you adjust it.

## Develop

```bash
pnpm install
pnpm test
pnpm typecheck
```

Tests run in the Workers runtime against local D1 and R2.

Turnstile's test keys show the widget, but the relay refuses their answer: it carries neither your hostname nor the `guest` action. Tests stub Siteverify instead.
