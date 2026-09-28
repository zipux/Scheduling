# Decisions

One line each: date — decision — reason. Append only.

- 2026-09-28 — Use the hosted Neon Postgres from `.env` (DATABASE_URL / TEST_DATABASE_URL) instead of Docker Compose Postgres — owner's instruction for this run overrides Spec §2 / Rule 4/9; no docker-compose.yml is shipped yet.
- 2026-09-28 — Prisma 7.10.0 (latest stable) rather than the npm `latest` tag (8.0.0-rc.17) — the `latest` tag points at a release candidate.
- 2026-09-28 — Prisma 7 layout: `prisma.config.ts`, `prisma-client` generator output in `src/generated/prisma` (git-ignored, regenerated on `postinstall`), `@prisma/adapter-pg` driver adapter — required by Prisma 7.
- 2026-09-28 — Migrations read `MIGRATE_DATABASE_URL` if set, else `DATABASE_URL` — Neon's pooled URL works for migrate today, but providers differ.
- 2026-09-28 — Auth: Better Auth 1.7 (email/password + magic-link plugin); Auth.js fallback not needed — Spec §2 first choice worked.
- 2026-09-28 — Public sign-up disabled for both password and magic link; accounts are created only from invitations (seeded users are created directly with Better Auth's `hashPassword`) — Spec §4 "no passwords are ever shared" / invitation-only onboarding.
- 2026-09-28 — Magic-link tokens stored hashed, 15-minute expiry, single use — Spec §4 token hygiene applied to sign-in links too.
- 2026-09-28 — Better Auth's built-in rate limiter uses in-memory storage (10/min password, 5/min magic link); app-level limits (invitations, exports, PIN) use a Postgres fixed-window table `RateLimit` — memory store is fine for a single Node instance; switch Better Auth to `storage: "database"` if deployed multi-instance.
- 2026-09-28 — Every tenant-owned table carries `businessId` directly (denormalised) — lets the data-access layer enforce isolation with one uniform rule instead of per-model join logic.
- 2026-09-28 — Data-access layer is a Prisma client extension `tenantDb(businessId)`: ANDs `businessId` into every where, stamps it on creates, verifies every `*Id` reference points into the same business, refuses nested relation writes, restricts `User` to members and forbids traversing user→other memberships/sessions/accounts, and blocks auth tables — isolation enforced in one place and proven by `tests/integration/tenant-isolation.test.ts`; a unit test keeps its model lists in sync with the schema.
- 2026-09-28 — Only `src/server/{db,auth,platform,email}`, `audit.ts`, `rate-limit.ts` and `/dev` may import the raw Prisma client (ESLint `no-restricted-imports`) — makes bypassing the tenant layer a lint error.
- 2026-09-28 — Raw SQL (`$queryRaw`) is not intercepted by the tenant extension; it is only used in whitelisted server modules — Prisma extensions cannot scope raw SQL.
- 2026-09-28 — Business is selected by URL (`/b/[businessId]/…`), not by a cookie — two tabs on two businesses can never post an action to the wrong business.
- 2026-09-28 — A non-member requesting `/b/<id>` gets 404, never 403 — a 403 would confirm the business exists (Spec §7.1 isolation).
- 2026-09-28 — Money stored as integer cents (`Wage.rateCents`; salary = cents per year); multipliers/percentages as Decimal — avoids float rounding in pay calculation.
- 2026-09-28 — `Business.workDayStart` stored as `workDayStartMinutes` (default 240 = 04:00 local) — integer minutes are unambiguous and easy to test.
- 2026-09-28 — Overtime/min-daily-pay/split-shift/holiday-eligibility settings live on a 1:1 `PayRules` table; `vacationPayPercent`, `workDayStartMinutes`, `burdenPercent` stay on `Business` as the spec names them — keeps the Pay rules screen backed by one row.
- 2026-09-28 — Added tables beyond §13: `RateLimit`, `PinAttempt` (PIN attempt log, §7.1), `ScheduleConflict` (§6.4 dashboard items), `PayRules` — each backs an explicit spec requirement.
- 2026-09-28 — Default permission sets: Owner all; General Manager all except `roles.manage`/`payrules.manage`; Manager people/schedule/approvals/time/timesheets/reports/broadcast; Assistant Manager schedule/approvals/time edits/broadcast; Shift Lead `trades.approve`; Employee none — spec gives role names but not their default permissions; owner can change all of them.
- 2026-09-28 — Province presets (`src/lib/pay-presets.ts`) for CA-ON, CA-BC, CA-AB, CA-QC, US-CA, US baseline, generic; seeded unconfirmed — spec requires presets but not their values; owner must confirm them on Pay rules, the app never claims compliance.
- 2026-09-28 — Product name "Shiftwise" in UI/email copy — spec names no product; one string in `messages/en.json` to change.
- 2026-09-28 — i18n with next-intl "without i18n routing": locale from a `locale` cookie, English complete, fr-CA/ja catalogues fall back to English key-by-key — Spec asks for structure ready for fr-CA/ja, not locale-prefixed URLs.
- 2026-09-28 — System font stack instead of `next/font/google` — no network fetch at build time (Spec rule 4: no external services required).
- 2026-09-28 — shadcn/ui (base-nova style) with button/input/select/tab heights raised to 44px on mobile (`h-11 md:h-9`) — Spec §11 touch targets ≥ 44 px.
- 2026-09-28 — Next.js dev indicator disabled — it overlaps the mobile bottom tab bar and intercepts taps.
- 2026-09-28 — Missing `BETTER_AUTH_SECRET` / `PIN_HMAC_SECRET` fall back to fixed insecure placeholders in development and throw in production — the provided `.env` only has database URLs; dev must still run.
- 2026-09-28 — Integration + e2e tests run against `TEST_DATABASE_URL`; e2e global setup re-seeds it (TRUNCATE); integration tests create uniquely-named businesses and never truncate — safe to run repeatedly against a shared remote DB.
- 2026-09-28 — Prisma interactive transactions: maxWait 15 s / timeout 30 s — remote Neon connections can take several seconds to start a transaction after idling.
