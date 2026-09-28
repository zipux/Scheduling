# Progress

Append-only log, newest phase at the bottom.

## Phase 1 — Foundation — ✅ complete (2026-09-28)

**What works**
- Next.js 16 (App Router, TS strict), Tailwind 4, shadcn/ui, lucide.
- Prisma 7 schema covering the whole §13 data model (+ `PayRules`, `RateLimit`, `PinAttempt`, `ScheduleConflict`), first migration applied to dev and test DBs. Partial unique index for one active pickup claim per shift is in the migration.
- Better Auth: email/password + magic link (hashed, single-use, 15 min), public sign-up disabled, rate-limited.
- Multi-tenant data-access layer `tenantDb(businessId)` (src/server/db/tenant.ts) + ESLint rule banning the raw client elsewhere.
- Business context (`requireBusinessPage` / `requireBusinessAction`), pure permission rules (`src/lib/permissions.ts`) incl. "nobody edits own time", rank rule, self-approval setting.
- App shell: `/b/[businessId]` with mobile bottom tab bar (Schedule, Clock, Requests, Messages, More) and desktop side nav; business switcher; 404 for non-members.
- i18n (next-intl) — English complete, fr-CA/ja catalogues with fallback.
- Dev email fallback: `EmailLog` + console + `/dev/emails` viewer; React Email templates.
- Seed (`npm run db:seed`): platform admin, 2 businesses, 3 locations, all roles, 12 people (one in both businesses) with profiles, PINs and wages.

**Tests**
- Unit (39): permissions allowed/denied, crypto (RFC 4231 HMAC vector, per-membership PIN digest), DAL↔schema sync, i18n catalogue keys.
- Integration (16): tenant isolation — reads, writes, cross-business references, nested writes, Business/User discovery, auth tables, transactions.
- E2E (8 × mobile 375 px + desktop): sign-in redirect, wrong password, dashboard + nav, owner nav, 404 across businesses, multi-business switcher, magic-link via dev email, no account enumeration.

**Known issues / notes**
- Pages other than Home/More are empty-state placeholders until their phase.
- The Neon database is remote; integration + e2e suites take ~1–2 minutes mostly due to latency.
- `next dev` logs "The destination stream closed early" when Playwright navigates away mid-stream; harmless.

**Next:** Phase 2 — Onboarding (platform admin, create business, invitations with bounce handling, profile completion, PIN setup, roles & permissions UI).
