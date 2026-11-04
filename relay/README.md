# Snap2Link relay

Temporary image hosting for Snap2Link, so that a capture can become a link without a Google account. It runs on Cloudflare Workers, with images in R2 and quotas in D1.

The app holds no secret: it calls a public URL. Quotas are enforced here, because forks can change the app.

## API

### `POST /v1/captures`

The body is the PNG itself.

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
| 413 | `too_large` | Over 5 MB |
| 415 | `not_png` | Not a PNG |
| 429 | `daily_limit` | This address used its 5 captures of the day |
| 503 | `service_busy` | A global limit is reached, try again later |

### `GET /{id}.png`

Returns the image, or 404 once it is deleted or expired. `HEAD` works too.

### `DELETE /v1/captures/{id}`

Needs `Authorization: Bearer <delete_token>`. Returns 204, or 404 if the capture doesn't exist or the token is wrong.

## Limits

All of them are in [`src/limits.ts`](src/limits.ts), which also explains how they keep the service inside the free tiers. Raising one can create a bill.

## Privacy

Addresses are never stored. Quotas use a hash of the address that changes every UTC day, and IPv6 addresses count per /64. Images are removed at expiry, and a link stops working at that moment even if the cleanup job hasn't run.

## Run it yourself

The relay is MIT, like the rest of Snap2Link. For your own instance:

1. In `wrangler.jsonc`, change `routes`, `PUBLIC_URL`, `ABUSE_CONTACT`, and the bucket and database names.
2. Create the storage, and copy the printed id into `database_id`:

   ```bash
   pnpm exec wrangler d1 create snap2link-relay
   pnpm exec wrangler r2 bucket create snap2link-relay
   pnpm exec wrangler d1 migrations apply snap2link-relay --remote
   ```

3. Set the salt to a long random value:

   ```bash
   pnpm exec wrangler secret put IP_SALT
   ```

4. Deploy, then add a rate limiting rule on the hostname in the Cloudflare dashboard. A rule stops a single source before it reaches the Worker. Workers quotas are per account, so a flood here can affect your other Workers.

   ```bash
   pnpm exec wrangler deploy
   ```

## Taking a capture down

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
