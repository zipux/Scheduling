# Shiftwise — shift scheduling & time clock

A multi-tenant web app for restaurants and shops. Businesses schedule staff, handle time off and
shift trades, message each other, and track hours with a PIN + geofenced time clock that also
works offline. Timesheets turn punches into pay lines under each business's own pay rules.

- **Specification:** `Spec.md` (v2). **Build log:** `PROGRESS.md`. **Every judgement call:** `DECISIONS.md`.
- **Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind 4 + shadcn/ui, PostgreSQL + Prisma 7,
  Better Auth, Resend + React Email, next-intl, Vitest, Playwright.

> Next.js 16 differs from older versions in places. `AGENTS.md` points at the bundled docs in
> `node_modules/next/dist/docs/`. Read those before changing framework-level code.

---

## 1. Setup

### Requirements

- Node.js 20.9+ (Next.js 16's minimum) and npm
- PostgreSQL 16+. Use the bundled `docker-compose.yml` or any hosted Postgres (this build was run
  against Neon). You need **two databases**: one for development and one for tests. The test
  database is truncated by the test suites.

### First run

```bash
cp .env.example .env          # then fill it in (see section 2)
npm install

# Option A: local Postgres in Docker (creates `scheduling` and `scheduling_test`)
docker compose up -d
# Option B: a hosted Postgres. Put both connection strings in .env.

npm run db:deploy             # apply migrations to DATABASE_URL
npm run db:test:deploy        # apply migrations to TEST_DATABASE_URL
npm run db:seed               # DESTRUCTIVE: truncates the dev DB and loads demo data
npm run dev                   # http://localhost:3000
```

In development, emails are not sent unless `RESEND_API_KEY` is set. They are stored and can be read at
**http://localhost:3000/dev/emails**. This includes magic links, invitations and notification
digests. The page lets you simulate delivered / bounced / complained events.

---

## 2. Environment variables

All variables are documented in `.env.example`. Never commit `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres for the app. |
| `TEST_DATABASE_URL` | for tests | A **different** database. Integration and e2e tests truncate it. |
| `MIGRATE_DATABASE_URL` / `TEST_MIGRATE_DATABASE_URL` | no | Non-pooled URLs for `prisma migrate`, if your provider's pooler can't run migrations. |
| `APP_URL` | production | Public base URL, used in email links and by auth. Must be `https://…` in production. |
| `BETTER_AUTH_SECRET` | production | Session signing secret. Generate with `openssl rand -base64 48`. |
| `PIN_HMAC_SECRET` | production | Secret for the clock-in PIN HMAC-SHA256. **Changing it invalidates every stored PIN.** |
| `RESEND_API_KEY` | no | Sends real email. Without it, email goes to `/dev/emails` (dev) and the `EmailLog` table. |
| `RESEND_WEBHOOK_SECRET` | with Resend | Verifies the delivery webhook (`/api/webhooks/resend`) for bounce handling. |
| `EMAIL_FROM` | with Resend | Sender, e.g. `Shiftwise <no-reply@yourdomain>`. |
| `CRON_SECRET` | no | Enables `POST /api/cron/notifications` (Bearer token) for an external scheduler. |
| `DISABLE_BACKGROUND_JOBS` | no | `1` turns off the in-process minute timer (notification flush, missing clock-out sweep). |
| `UPLOAD_DIR` | no | Local folder for message images in development (default `./.dev-uploads`). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | production | S3-compatible storage (AWS S3, Cloudflare R2, MinIO) for message images. |
| `DISABLE_RATE_LIMIT`, `E2E_PORT`, `E2E_SKIP_SEED`, `E2E_PROD` | tests | See section 4. |

Development falls back to insecure placeholder secrets so `npm run dev` works from a minimal `.env`.
A production server refuses to start without `BETTER_AUTH_SECRET` and `PIN_HMAC_SECRET`. The check
runs at start-up (`src/instrumentation.ts`), not during `next build`.

---

## 3. Seed accounts

`npm run db:seed` creates two businesses. Every account's password is **`password1234`**.
PINs are for the time clock (personal or kiosk).

**Platform admin:** `admin@example.com`

**Maple Bistro** (Toronto, ON; locations *King St* and *Queen St*; bi-weekly pay; Ontario pay-rule preset)

| Email | Name | Role | PIN | Notes |
|---|---|---|---|---|
| owner@maple.example.com | Olivia Owner | Owner | 1111 | |
| gm@maple.example.com | Gina General | General manager | 2222 | Has an entry flagged BREAK_MISSED |
| manager@maple.example.com | Marco Manager | Manager | 3333 | In the seeded DM |
| assistant@maple.example.com | Aisha Assistant | Assistant manager | 4444 | |
| lead@maple.example.com | Leo Lead | Shift lead | 5555 | Has an OFFLINE_QUEUED entry |
| emma@maple.example.com | Emma Server | Employee | 1234 | In the seeded DM |
| noah@maple.example.com | Noah Cook | Employee | 2345 | Forgot to clock out (MISSING_CLOCK_OUT) |
| mia@maple.example.com | Mia Bartender | Employee | 3456 | Two locations |
| liam@maple.example.com | Liam Host | Employee | 4567 | Under 18 (minimum-age warnings) |
| clara@maple.example.com | Clara Clock | Employee | 2580 | No shifts: try the clock any time |
| omar@maple.example.com | Omar Offline | Employee | 1470 | |
| pat@maple.example.com | Pat Kiosk | Employee | 3690 | |
| sam@example.com | Sam Shared | Employee | 9876 | Also works at Harbour Café |

**Harbour Café** (Vancouver, BC; location *Waterfront*; BC pay-rule preset)

| Email | Name | Role | PIN |
|---|---|---|---|
| owner@harbour.example.com | Henry Harbour | Owner | 1111 |
| ava@harbour.example.com | Ava Barista | Employee | 1357 |
| sam@example.com | Sam Shared | Employee | 2468 |

The seed also creates two weeks of shifts with a statutory holiday inside the pay period, time-off
and trade requests, messages (a DM, a "Kitchen crew" group, an announcement asking for read
confirmation) and clock entries carrying every blocking flag.

---

## 4. Tests

```bash
npm run typecheck        # next typegen + tsc --noEmit
npm run lint             # includes the rule that bans the raw Prisma client outside the tenant layer
npm test                 # unit (Vitest): pay rules (§7.6.9), permissions, crypto, geo, i18n…
npm run test:integration # integration (Vitest) against TEST_DATABASE_URL: tenant isolation, concurrency…
npm run test:e2e         # Playwright, every spec on mobile (375×812) and desktop (1280×800)
npm run test:e2e:prod    # accessibility + Phase 9 specs against a production build (next build && next start)
```

Notes:

- The e2e suite re-seeds `TEST_DATABASE_URL` in its global setup, starts `next dev` on port 3100
  (`E2E_PORT`), and disables rate limiting. `E2E_SKIP_SEED=1` reuses the existing seed. Don't run
  integration tests at the same time: both use the test database.
- **Read the pay-rule expectations yourself:** `tests/unit/pay-rules.test.ts` holds the §7.6.9 cases
  with their expected values.
- `tests/e2e/a11y.spec.ts` scans every screen with axe (WCAG 2.1 A/AA). On mobile it also checks
  there is no horizontal scroll and that touch targets are at least 44 px.
- The offline punch test in `tests/e2e/polish.spec.ts` only runs in full under `test:e2e:prod`.
  `next dev` loads its hot-reload client at runtime, so a page served from the service worker
  cache can't run its scripts offline in development.

---

## 5. Deploying

This build has not been deployed (Spec rule 9). It assumes a standard Node runtime. Checklist:

1. **Database:** create a production Postgres and set `DATABASE_URL` (and `MIGRATE_DATABASE_URL`
   if migrations need a direct connection). Run `npm run db:deploy` on every release, before the new
   code starts. **Never run `db:seed` against production:** it truncates.
2. **Secrets:** set `BETTER_AUTH_SECRET`, `PIN_HMAC_SECRET` (keep it forever; see section 2) and
   `APP_URL=https://your-domain`.
3. **Build and start:** `npm ci && npm run build && npm start`. HTTPS is required: the service
   worker, "install app", geolocation and secure cookies all depend on it.
4. **Email:** create a Resend API key and a verified sending domain, set `RESEND_API_KEY` and
   `EMAIL_FROM`. Add a webhook to `https://your-domain/api/webhooks/resend` for
   `email.delivered`, `email.bounced` and `email.complained`, and set `RESEND_WEBHOOK_SECRET`.
5. **File storage:** set the `S3_*` variables. The adapter has not been tested against a real bucket
   yet. Upload and view a message image once after deploying.
6. **Background jobs:** the server flushes batched notifications and flags missing clock-outs every
   minute in-process. On a platform that scales to zero or runs several instances, set
   `DISABLE_BACKGROUND_JOBS=1` and call `POST /api/cron/notifications` with
   `Authorization: Bearer $CRON_SECRET` every minute from a scheduler.
7. **First login:** `DATABASE_URL=… npm run admin:create -- you@yourdomain.com "Your Name"` creates
   (or promotes) the platform admin. Sign in with "Email me a sign-in link", then create businesses
   from `/admin`. Owners are invited by email. Nobody ever receives a password.
8. **After deploying:** open the app on a phone and check that it installs to the home screen. Then
   turn on flight mode and check that the clock still opens and queues a punch.

Production also serves `nosniff`, `DENY` framing and a strict referrer policy on every response
(`next.config.ts`). `/sw.js` is never cached, so service-worker fixes reach devices on their next visit.

---

## 6. How it fits together

- `src/server/db/tenant.ts`: `tenantDb(businessId)`. Every business query goes through it. It adds
  the business to every filter and rejects cross-business references. `src/server/platform/**` is
  the only other code allowed to use the raw client, because it deals with the platform admin,
  invitations and per-user data export.
- `src/lib/pay/*` and `src/lib/time-flags.ts`: §7.6 pay rules and §7.7 flags as pure functions.
- `src/server/services/*`: business logic. `src/app/**/actions.ts`: server actions (Zod-validated).
- `public/sw.js`: the offline shell. It is network-first. It keeps the clock page and its assets for
  offline use, and punches go to the device queue (`src/components/app/punch-queue.ts`).
- `messages/en.json`: all UI text. `fr-CA` and `ja` fall back to English per key.

## 7. Known limitations

See the latest `PROGRESS.md` entry. In short: web push isn't implemented (the notification pipeline
is ready for it). Profile photos aren't built. Account deletion is a request that the platform admin
processes by hand. The S3 adapter hasn't been tested against a real bucket.
