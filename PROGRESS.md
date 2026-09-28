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

## Phase 2 — Onboarding — ✅ complete (2026-09-28)

**What works**
- Platform admin (`/admin`): list businesses, create business + invite owner (country/province/timezone/currency; roles and pay-rule presets seeded), suspend/reactivate, subscription status, resend owner invite.
- Invitations: random token stored SHA-256 hashed, single-use (conditional update), 7-day expiry, resend (new token, old link dies), revoke, rate-limited. Rank rules on who can invite to which role; wage only with `wages.edit`.
- Delivery tracking: `/api/webhooks/resend` (Svix-verified) writes delivered/bounced/complained onto EmailLog + Invitation; "Delivery failed" state with one-click *Edit address & resend*; dashboard warning while any invitation is bounced or unaccepted > 72 h. Dev emails page can simulate each event.
- Accept flow `/invite/[token]`: new account with own password or magic link; existing account signs in then accepts (adds the business); wrong-account and expired/revoked/used states.
- Profile completion gate (phone with country code, DOB, address, emergency contact, 4–6 digit PIN twice) — PIN stored as per-membership HMAC-SHA256.
- PIN: change from Account (password or fresh magic-link session), manager reset → employee sets a new one.
- Owner setup wizard: first location + geofence (lat/lng, use my position, radius, mode), pay period, pay rules pre-filled from province preset with mandatory responsibility confirmation, roles review.
- People: members list, member detail (private fields only with `employees.edit`), change role, reset PIN, deactivate (access revoked now; separate payroll end date) / reactivate.
- Settings → Roles & permissions: create/edit/delete custom roles, rank, permission toggles, Owner role locked.

**Tests**: unit 63, integration 45 (invitations incl. single-use/expiry/revoke/bounce/resend, role & rank rules allowed+denied, deactivation/sessions, PIN HMAC/change/reset), e2e 27 on mobile 375 px + desktop (admin → owner → wizard; invite → bounce → fix → magic-link accept → profile; existing user accepts second business; roles UI; employee 404s; PIN change).

**Known issues / notes**
- Profile photo not implemented yet (optional; planned with file storage in Phase 8).
- Map pin for geofence comes in Phase 3.

**Next:** Phase 3 — Locations, positions & wages (settings screens, geofence picker + test tool, wage history).

## Phase 3 — Locations, positions & wages — ✅ complete (2026-09-28)

**What works**
- Settings → Business: business info (name, timezone, currency, minor age threshold, payroll burden % + note, directory visibility), request rules (self-approval, escalation, notice, approval per request type), time clock rules (modes, early clock-in, unscheduled, rounding with legal-risk warning, tolerance, max shift hours, clock skew, work-day start).
- Settings → Locations: list/create/edit/archive (never the last one), timezone, temporary flag, geofence mode/centre/radius with Leaflet map picker, "Use my current position", and the 10-reading **Test geofence** tool with a recommended radius.
- Settings → Positions: create/edit/archive, colour, minimum age.
- People → person: edit locations & positions; wage history (self, or `wages.view`); add wage (hourly per position or general, or salary) with effective date, guarded against approved pay periods; Account → My pay.
- Pure libs: haversine distance + geofence recommendation (`src/lib/geo.ts`), wage resolution (`src/lib/wages.ts`).

**Tests**: unit 82, integration 63, e2e 37 (+1 skipped by design) on mobile + desktop.

**Known issues / notes**
- Map tiles come from OpenStreetMap at runtime (optional; everything works without them).
- Location switcher (§5.2) is built with the schedule in Phase 4.

**Next:** Phase 4 — Scheduling (shifts, open shifts, draft/publish, templates, copy week, persistent warnings, Scheduled wages, .ics feed).

## Phase 4 — Scheduling — ✅ complete (2026-09-28)

**What works**
- Schedule: week navigation; desktop grid employees × days with an Open shifts row and drag & drop (move day/person, keeps local times); mobile day list with day tabs; location switcher (single by default, All locations adds a location label; remembered; hidden with one location; location required when "All" is selected).
- Shift editor: date/start/end (overnight aware)/planned break/location/position/employee or open/notes/off-site geofence override (off or custom centre + radius); templates; live warnings at assignment.
- Persistent warnings (§5.1): unavailable, approved time off, overlap, overtime risk (day/week), short rest, split-shift span, below minimum age — shown in the editor, on the shift (draft and published), in the publish dialog listing every warning of the week, and on the manager dashboard while the shift is in the future.
- Draft vs published; publish week (only staff whose own shifts changed are notified); edits/deletes of published shifts queue batched before → after notifications (10-min debounce, one message per person per week, flushed every minute in-process; email via dev fallback).
- Copy last week (DST-correct, idempotent), shift templates.
- Scheduled wages per day and week for `wages.view`, with Est. loaded cost + tooltip when burden % is set.
- Statutory holidays shown on the grid/day list.
- Employees: My shifts, read-only team schedule (published only, no wages, no warnings), private per-user .ics feed (rotatable).
- Dashboard: next shift card; upcoming shifts with warnings (managers).

**Tests**: unit 105, integration 84 (incl. 50-employee week load < 2 s), e2e 46 (+2 skipped by design) on mobile + desktop.

**Known issues / notes**
- The in-app notification bell and email preferences UI arrive in Phase 8 (the rows and emails already exist).
- Availability and time-off data sources arrive with Phase 5; the warnings already read them.

**Next:** Phase 5 — Requests (shared eligibility predicate, time off, blackout dates, availability, drop/pickup/swap with concurrency test, approvals, published-shift re-check).
