# Snap2Link relay

Temporary image hosting for Snap2Link, so that a capture can become a link without a Google account. It runs on Cloudflare Workers, with images in R2 and quotas in D1.

The app ships no secret: anything it contained could be extracted. Each install gets a guest token instead, after passing Cloudflare Turnstile once. Quotas are enforced here, because forks can change the app.

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

Needs `Authorization: Bearer <guest_token>`. The body is the PNG itself.

```json
{
  "id": "4fGh2kLm9PqRs7TuVw1XyZ",
  "url": "https://i.snap2link.app/4fGh2kLm9PqRs7TuVw1XyZ.png",
  "delete_token": "…",
  "expires_at": "2026-11-04T18:00:00.000Z"
}
```

| Status | `error` | Meaning |
|---|---|---|
| 201 | | Stored |
| 401 | `guest_required` | No guest token, or an unknown or expired one: get a new one |
| 403 | `guest_banned` | This guest is banned |
| 413 | `too_large` | Over 5 MB |
| 415 | `not_png` | Not a PNG |
| 429 | `daily_limit` | This guest used its 5 captures of the day, or this address its 30 |
| 503 | `service_busy` | A global limit is reached, try again later |

### `GET /{id}.png`

Returns the image, or 404 once it is deleted or expired. `HEAD` works too.

### `DELETE /v1/captures/{id}`

Needs `Authorization: Bearer <delete_token>`. Returns 204, or 404 if the capture doesn't exist or the token is wrong.

## Limits

All of them are in [`src/limits.ts`](src/limits.ts), which also explains how they keep the service inside the free tiers. Raising one can create a bill.

## Privacy

Addresses are never stored. Quotas use a hash of the address that changes every UTC day, and IPv6 addresses count per /64. A guest is a random token, kept as a hash with its dates: nothing about the device is collected. A capture keeps the hash of its guest until it expires, so that abuse can be traced to a guest and to nothing else. Images are removed at expiry, and a link stops working at that moment even if the cleanup job hasn't run.

## Run it yourself

The relay is MIT, like the rest of Snap2Link. For your own instance:

1. Create a Turnstile widget for your hostname, in Managed mode. In `wrangler.jsonc`, change `routes`, `PUBLIC_URL`, `ABUSE_CONTACT`, `TURNSTILE_SITEKEY`, and the bucket and database names.
2. Create the storage, and copy the printed id into `database_id`:

   ```bash
   pnpm exec wrangler d1 create snap2link-relay
   pnpm exec wrangler r2 bucket create snap2link-relay
   pnpm exec wrangler d1 migrations apply snap2link-relay --remote
   ```

3. Set the salt to a long random value, and the secret key of the widget:

   ```bash
   pnpm exec wrangler secret put IP_SALT
   pnpm exec wrangler secret put TURNSTILE_SECRET
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
