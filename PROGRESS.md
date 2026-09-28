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

## Phase 5 — Requests — ✅ complete (2026-09-28)

**What works**
- Shared eligibility predicate `isEligibleFor` (src/lib/eligibility.ts) used by pickup, swap and (informationally) direct assignment: position, location/scope_all, minimum age, overlap, approved time off.
- Time off: full or partial day, configurable types, blackout dates block at submission with the reason (and are listed on the form), minimum notice (not for sick), cancel while pending, approve/deny with note; self-approval by setting (audited SELF_APPROVED, rules re-checked); Escalated flag when self-approval is off.
- Blackout dates settings (business-wide or per location, `blackout.manage`).
- Availability: weekly set with effective-from; approval per business setting.
- Drop / pickup / swap with per-type approval settings; original employee stays responsible until approved; conditional-update claim + partial unique index per claim round; **ten-simultaneous-claims test passes with exactly one winner, in both approval modes**.
- §6.4: approving time off or availability re-checks published future shifts → SCHEDULE_CONFLICT cards on the dashboard with Reassign / Make open / Keep anyway.
- UI: Requests page (My requests, Available shifts, Approvals), Drop/Swap on My shifts with eligible swap candidates, dashboard request counts.

**Tests**: unit 124, integration 90 (incl. concurrency), e2e 52 (+4 skipped by design) on mobile + desktop.

**Known issues / notes**
- Request notifications are in-app rows only until the Phase 8 bell/preferences UI.

**Next:** Phase 6 — Time clock (punches, breaks, geofence check, offline queue, kiosk devices, missing-punch flow, corrections + audit).

## Phase 6 — Time clock — ✅ complete (2026-09-28)

**What works**
- Personal clock (`/b/…/clock`): PIN-confirmed clock in / start & end break / clock out; server-side geofence (haversine; required / warn / off; poor accuracy accepted + GEO_UNCERTAIN; shift override → OFFSITE; kiosk skips GPS); position and accuracy stored on every punch; early clock-in window, unscheduled (flag or refuse), LATE / EARLY_LEAVE; rounding (none by default) with raw times kept.
- PIN: per-membership HMAC-SHA256, 5 wrong attempts → 5-minute lock, all attempts logged.
- Offline punches: queued on the device with device time + last GPS fix, synced on reconnect, OFFLINE_QUEUED with device and server time; rejected beyond `maxClockSkewMinutes`.
- Missing clock-out: never closed automatically; flagged after `maxShiftHours`, excluded from "working now", employee and managers notified; next clock-in asks for the previous finish time (a correction request, not a punch). Clock-out with no clock-in → MISSING_CLOCK_IN.
- Corrections (§7.4): managers edit (reason mandatory, immutable before/after audit), add missing entries, confirm flags; employees request corrections and can see each entry's history; nobody can edit their own time (owner included).
- Time review page: working now, Unresolved time queue (blocking flags first), correction requests, add entry.
- Kiosk devices: own identity (hashed token bound to business + location), enrol signs the manager out, staff names + punch only, manager PIN to exit (revokes), Settings → Kiosk devices with last-seen and revoke.
- Multi-business: `/clock` defaults to the soonest shift's business, switcher on the clock page, "All my hours" across businesses for the user only; isolation test proves one business can't discover the other.
- Seed: entries carrying MISSING_CLOCK_OUT, MISSING_CLOCK_IN, OFFLINE_QUEUED, GEO_UNCERTAIN, GEO_OUTSIDE, OFFSITE, UNSCHEDULED, LATE, EARLY_LEAVE (BREAK_MISSED arrives with Phase 7a).

**Known issues / notes**
- Offline shell (service worker) is Phase 9; the punch queue works whenever the page is open.

**Next:** Phase 7a — §7.6 and §7.7 as pure, tested functions with no UI. Every §7.6.9 test must pass before 7b.

## Phase 7a — Pay rules & time-entry flags as pure functions — ✅ complete (2026-09-28)

**What works** (`src/lib/pay/*`, no UI)
- Work-day and pay-period assignment (§7.6.1), worked time from actual break punches (§7.6.3), BreakRule violations, overtime allocation with the mandatory order of operations (§7.6.2), statutory-holiday premium and average-day entitlement with the inputs shown and override (§7.6.4), vacation accrual (§7.6.5), minimum daily pay (§7.6.6), salaried staff, approval gate with Owner "approve with exceptions" (§7.6.7).
- §7.7 flag vocabulary and blocking set (`src/lib/time-flags.ts`); BREAK_MISSED now raised at clock-out/after edits with explicit "taken, add it" / "missed, pay it" resolutions.
- Presets now carry the average-day formula: CA-ON fixed ÷20 over 28 days, CA-BC ÷ days worked over 30 days.

**§7.6.9 required tests — all passing, expected values in `tests/unit/pay-rules.test.ts`** (51 tests):
- 12-hour day inside a 46-hour week: BC rules → 40 h regular + 6 h daily OT + **0 h weekly OT**, $980.00; Ontario rules → 44 h + 2 h weekly OT, $940.00; 13-h day pays the 13th hour ×2 once.
- Entry 21:00 Sun → 02:10 Mon: 5 h 10 m wholly in the Oct 5–18 period ($103.33), nothing in the next.
- DST: 21:00 → 05:00 across fall-back = 9 h; across spring-forward = 7 h.
- Midnight with workDayStart 04:00: a 01:00 clock-in joins the previous work-day (9 h → 1 h daily OT); with 00:00 it doesn't.
- Holiday worked eligible ($240 premium), worked ineligible (premium still paid), not worked eligible ($3,200 ÷ 20 = $160), not worked ineligible (inputs show 22 days employed < 30), override, formula not configured → blocked.
- Vacation accrual: 4% × $980.00 = $39.20.
- Approval blocked by each of MISSING_CLOCK_OUT, MISSING_CLOCK_IN, BREAK_MISSED, OFFLINE_QUEUED in turn; Owner-with-exceptions allowed; non-blocking flags never block.

**Tests**: unit + integration 304 passing.

### Blocked (§7.6 leaves these open — the app refuses to calculate rather than guess; owner decision needed)
1. **Weekly overtime with semi-monthly or monthly pay periods** — the spec doesn't define which 7-day week applies when weeks straddle periods, nor how a straddling week is paid. Such timesheets report `WEEK_UNDEFINED` and can't be approved. (Weekly and bi-weekly periods are fine.) Decide: work-week start day, and whether a straddling week's overtime is paid in the period where the week ends.
2. **Overtime in a week with more than one hourly rate** (position-specific wages) — the spec doesn't say which rate overtime is paid at (rate of the hour worked, a weighted average "regular rate", or the higher rate). Reported as `MIXED_RATE_OVERTIME`; can't be approved. Weeks with one rate, or with no overtime, are unaffected.
3. **`BreakRule.paidWhenNotTaken`** — stored but has no effect: the spec says the manager resolves a missed break as "taken, add it" or "missed, pay it", and doesn't say what the setting changes (a premium? a default resolution?). Decide its meaning before relying on it.
4. **Average day's pay formula** — not blocked in code but owner-configured on purpose (divisor: days worked or a fixed number; straight-time wages in the lookback window). Businesses outside CA-ON / CA-BC get `AVERAGE_DAY_NOT_CONFIGURED` until they set it.

### Needs a human look (interpretations, not guesses — see DECISIONS.md)
- Pay-period membership follows the work-day (a 01:00 Monday clock-in with workDayStart 04:00 belongs to the period containing Sunday).
- Holiday premium = hours × rate × multiplier **in addition** to normal pay (so ×1.5 means 2.5× total for those hours), and doesn't require eligibility.

**Next:** Phase 7b — pay periods, timesheet screens, approval gate UI, locking, CSV export, Pay rules screen, reports, dashboards.
