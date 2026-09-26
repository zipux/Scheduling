# Spec.md — Shift Scheduling & Time Clock Web App

**Version 2** — 27 September 2026. Supersedes v1.

> **For Claude Code:** You are building this app **unattended, overnight**. Nobody will answer questions.
> Read this whole file before writing code. Follow the **Autonomous Run Rules** below at all times.

---

## 0. Autonomous Run Rules (read first)

1. **Never stop to ask.** When something is ambiguous, pick the simplest option consistent with this spec, and write it down in `DECISIONS.md` (one line: date, decision, reason).
2. **Work in phases** (Section 12), in order. After each phase:
   - run typecheck, lint, unit tests and e2e tests for that phase;
   - fix failures before moving on;
   - `git commit` with a message like `phase 3: time off requests`;
   - update `PROGRESS.md` (phase, status, what works, known issues).

   **Depth beats breadth. Five phases finished properly is a better night's work than nine phases half-done.** The phase list is not a finish line to race to. If you are running short on time or context, stop cleanly at the end of a completed phase rather than starting one you cannot finish — a half-built phase is worse than an absent one, because it has to be read before it can be trusted. Record clearly in `PROGRESS.md` where you stopped and what the next phase should start with.
3. **If blocked** on the same problem after 3 serious attempts: record it in `PROGRESS.md` under "Blocked", leave a `TODO(blocked):` comment in code, and continue with the next phase.
4. **No external services required to run.** Everything must work locally with only Docker (Postgres). If `RESEND_API_KEY` is missing, emails are written to the database/console and viewable at `/dev/emails` (dev only).
5. **Never commit secrets.** Provide `.env.example` with every variable documented.
6. **Do not delete or rewrite** `Spec.md`, `DECISIONS.md` or `PROGRESS.md` history — append only.
7. **Mobile first.** Every screen is built and tested at 375px width first, then desktop.
8. **§7.6 and §7.7 are the highest-risk part of this build.** Pay calculation fails silently — it produces a clean CSV with wrong numbers. Implement those two sections and their unit tests *before* building any timesheet UI, and never guess at a rule they leave open: if something is genuinely unspecified there, stop and record it in `PROGRESS.md` under "Blocked" rather than choosing.
9. **Do not deploy.** Build and test locally against Docker Postgres. Deployment is a supervised step the following day.
10. At the end, write `README.md`: setup, env vars, seed accounts, how to run tests, how to deploy.

### What changed in v2

v1 was reviewed by tracing a fictional 26-person restaurant through one full bi-weekly pay period. Twenty-two questions the spec could not answer were found; all are resolved in this version. The material additions are **§7.6 (pay calculation rules)** and **§7.7 (time entry flags)**, plus statutory holidays and vacation pay, which were absent from v1 entirely.

---

## 1. Product Summary

A multi-tenant web app where businesses (restaurants, shops) schedule staff, handle time-off and shift-change requests, message each other, and track hours worked through a PIN + geofenced time clock. Wages are stored per employee so labour cost can be calculated.

Three levels of user:

| Level | Who | What they do |
|---|---|---|
| **Platform Admin** | The site owner (me) | Creates businesses, invites the business owner, manages subscription status |
| **Business users** | Owner, managers, etc. | Run their own business only; permissions depend on role |
| **Employees** | Staff | See schedule, request time off, trade shifts, clock in/out, message |

A user may belong to more than one business (e.g. works at two locations of different companies). All data is strictly isolated per business.

---

## 2. Tech Stack (use exactly this unless blocked)

- **Framework:** Next.js (latest stable, App Router) + TypeScript (strict)
- **UI:** Tailwind CSS + shadcn/ui, lucide icons
- **Database:** PostgreSQL (Docker Compose locally) + Prisma
- **Auth:** Better Auth (magic link + email/password). Fallback: Auth.js v5. Record choice in `DECISIONS.md`.
- **Email:** Resend + React Email templates (with dev fallback, see Rule 4)
- **Validation:** Zod on every server action / API input
- **Dates:** store everything in UTC; display in the **location's** timezone (use `date-fns` + `date-fns-tz` or Temporal polyfill)
- **i18n:** `next-intl`, English complete; structure ready for French (fr-CA) and Japanese
- **Realtime (messages/notifications):** polling every 5–10 s or Server-Sent Events. No extra infrastructure.
- **PWA:** installable manifest + service worker (offline shell **and offline punch queue**, see §7.1)
- **Tests:** Vitest (unit), Playwright (e2e, run on mobile viewport 375×812 AND desktop)
- **Deploy target:** decided after this build. Assume a standard Node runtime; do not write code that depends on edge-runtime-only or Node-only APIs unnecessarily.

**Runtime note.** A move to Cloudflare Workers is under consideration for later. Do not target it now, but avoid gratuitous dependence on Node-native modules where a Web Crypto equivalent exists. In particular, the clock PIN HMAC (§7.1) must use standard SHA-256 HMAC, which is portable.

---

## 3. Roles & Permissions

### 3.1 Default roles (created automatically for every new business)

Ordered by **rank** (lower number = more senior):

1. **Owner** — all permissions, cannot be deleted, at least one per business
2. **General Manager**
3. **Manager**
4. **Assistant Manager**
5. **Shift Lead / Supervisor**
6. **Employee**

Owner can **create custom roles**, rename roles, change rank, and toggle permissions.

### 3.2 Permission keys (toggle per role)

| Key | Meaning |
|---|---|
| `business.settings` | Edit business info, locations, geofences, rules |
| `roles.manage` | Create/edit roles and permissions |
| `employees.invite` | Send invitations |
| `employees.edit` | Edit employee profile, deactivate |
| `wages.view` | See other people's wages |
| `wages.edit` | Change wages |
| `schedule.edit` | Create/edit draft shifts |
| `schedule.publish` | Publish schedule (notifies staff) |
| `timeoff.approve` | Approve/deny time off |
| `availability.approve` | Approve availability changes (if approval is required) |
| `trades.approve` | Approve shift drops / swaps / pickups |
| `blackout.manage` | Set dates when time off can't be requested |
| `holidays.manage` | Edit the holiday calendar and holiday entitlement overrides |
| `timeclock.edit` | Edit existing clock entries (with reason) |
| `timeclock.add` | Add missing clock entries for someone |
| `timesheets.approve` | Approve timesheets for a pay period |
| `payrules.manage` | Edit pay rules (§7.6) — overtime, breaks, holidays, vacation percent |
| `reports.view` | View labour / attendance reports, export CSV |
| `messages.broadcast` | Send announcements to everyone / a role / a location |
| `locations.scope_all` | Act on all locations (otherwise only assigned locations) |

### 3.3 Hard rules (enforce server-side)

- **Nobody may ever edit their own time entries.** This is absolute and has no setting. A time entry is money; corrections to your own hours always go through someone else via a correction request (§7.4).
- **Self-approval of requests is allowed by setting.** `Business.allowSelfTimeOffApproval` (default **true**). When true, a user holding `timeoff.approve` / `availability.approve` / `trades.approve` may approve their own requests of that type. Every self-approval is written to the audit log as `SELF_APPROVED`.
  - Self-approval skips the *reviewer*, never the *rules*: blackout periods, minimum notice and conflict checks (§6) all still apply.
  - When the setting is false, the rank rule below applies and requests pending beyond `escalateAfterHours` (default 72) are flagged **Escalated** and surfaced to every eligible approver.
- A user can only approve or edit **for people of lower rank**, unless they are Owner, or unless it is their own request under the setting above.
- Wages: an employee always sees **their own** wage and hours; others only with `wages.view`.
- Every permission check happens on the server. Hiding a button in the UI is not security.
- Every database query goes through a data-access layer that requires `businessId` — write a test proving a user of business A cannot read or write anything of business B.

---

## 4. Onboarding & Invitations (no passwords are ever shared)

### 4.1 Platform Admin → Business Owner
1. Platform Admin creates a **Business** (name, country, province/state, default timezone, currency).
2. Enters owner's **name + email** → invitation email via Resend with a single-use link.
3. Owner opens link → sets their own password (or continues with magic link) → lands on a **setup wizard**: first location + geofence, pay period, **pay rules (§7.6) with the seeded preset for their province**, confirm roles.

### 4.2 Business → Employee
1. A user with `employees.invite` enters **name + email + role + location(s)** (optional: position, wage, hire date).
2. Invitation email sent. Link expires after 7 days, can be **resent** or **revoked**.
3. Employee opens link → creates account (own password or magic link) → **must complete profile** before using the app:
   - phone number (with country code)
   - **date of birth** (store DOB, not "age"; age is calculated)
   - address
   - emergency contact (name, relation, phone)
   - **clock-in PIN** (4–6 digits, entered twice)
   - profile photo (optional)
4. If the email already has an account, the invitation just adds the new business to that account.

Invitation tokens: random, stored **hashed**, single-use.

**Delivery tracking.** Register a Resend webhook endpoint that writes `delivered` / `bounced` / `complained` onto `EmailLog`. An invitation whose email bounced shows a **Delivery failed** state in the invitation list with a one-click *Edit address & resend*. The manager dashboard shows a warning while any invitation is bounced, or still unaccepted after 72 hours. An invitation must never sit on "Invited" when the email never arrived.

---

## 5. Scheduling

- **Locations** → each has timezone, address, geofence, and `isTemporary` (for venues used for catering or events).
- **Positions / departments** (e.g. Kitchen, Server, Bar, Cashier) with a colour and an optional `requiresMinimumAge`. Employees can have several positions.
- **Weekly schedule view** (grid: employees × days) on desktop; **day list view** on mobile.
- Create shift: date, start, end, unpaid break length, location, position, employee (or **empty = open shift**), notes, optional `geofenceOverride` (§7.2).
- Copy previous week, **shift templates**, drag & drop on desktop.
- **Draft vs Published.** Staff only see published shifts. Publishing notifies staff; editing a published shift notifies the affected employee (see notification batching, §9).
- **Statutory holidays are shown on the grid** (§7.6) so the person building the schedule can see them before they build.

### 5.1 Scheduling warnings

All scheduling checks are **warnings, not blocks**. The manager may publish anyway. But a warning must be **persistent, not momentary** — v1's failure was a warning shown once at the moment of assignment and never again.

A warning is shown in all of these places until it is resolved or the shift is in the past:
- at the moment of assignment,
- on the shift itself in both draft and published views,
- in the publish confirmation dialog, listing every warning in the week being published,
- on the manager dashboard while the shift is still in the future.

Warning types: employee unavailable; approved time off; overlapping shifts; overtime risk; short rest between shifts; split-shift span exceeded (§7.6); and **below minimum age for the position**.

**Minimum age.** `Business.minorAgeThreshold` (default **19**; seeded per country/province — not hardcoded to 18) and `Position.requiresMinimumAge`. Where an employee's calculated age is below the position's requirement, raise the persistent warning above. Age is derived from DOB at the date of the shift, so it updates itself.

### 5.2 Working across locations

A person sees only the locations assigned to them on `MembershipLocation`, unless their role holds `locations.scope_all`, which grants every location in the business.

Where a user has access to more than one, the schedule, staff list, time clock review and reports all carry a **location switcher** in the header:

- It **defaults to a single location** — the one the user's next or current shift is at, otherwise the first one assigned to them. Most people think of themselves as running one room.
- It offers an **All locations** option, which merges the views and adds a location column (on desktop) or a location label per row (on mobile).
- The chosen location is remembered per user between sessions.
- Creating a shift while a single location is selected defaults that shift to it. While *All locations* is selected, location is a required field with no default, so a shift is never created at the wrong site by accident.

Where a user has access to exactly one location, no switcher is shown at all.

### 5.3 Cost display

Show **Scheduled wages** per day and per week to users with `wages.view` — hours × wage, labelled as such.

Do not label this figure "labour cost". It excludes employer payroll contributions, workers' compensation premiums and accrued vacation pay, and an owner will make pricing decisions against it. Where `Business.burdenPercent` is set, display both: `Wages $18,240 · Est. loaded cost $21,150`, with a tooltip stating exactly what the multiplier covers.

- Employees: "My shifts" list, full team schedule (read-only, no wages), add to calendar (.ics feed per user).

---

## 6. Requests

All requests share: status (`pending`, `approved`, `denied`, `cancelled`), reviewer, reviewer note, timestamps, notifications to both sides.

### 6.0 Shared eligibility rule

One predicate, `isEligibleFor(membership, shift)`, is used identically by **pickup, swap and direct assignment**. It checks: matching position; matching location (or `locations.scope_all`); `requiresMinimumAge` satisfied; no overlapping shift for that person; no approved time off covering it. v1 defined this for pickups only, which let a cook be swapped onto the bar.

Eligibility failures block trades. (Scheduling warnings in §5.1 remain warnings — a manager assigning deliberately is different from an employee swapping around a rule.)

### 6.1 Time off
- Full day(s) or partial day; type (vacation, sick, personal, unpaid, other — configurable).
- Blocked if it overlaps a **blackout date** (show the reason at submission, not as a denial three days later). Managers with `blackout.manage` define blackout ranges per business or per location.
- Optional business rule: minimum notice (e.g. 14 days) — configurable.
- Employee can cancel while pending.

### 6.2 Availability
- Recurring weekly availability (per weekday: available all day / available between times / unavailable), with an **effective-from** date.
- Business setting: availability changes need approval yes/no.

### 6.3 Shift drop / pickup / swap
- **Drop:** employee offers a shift → becomes open to eligible staff.
- **Pickup:** eligible employee claims an open shift.
- **Swap:** employee proposes exchanging with a specific coworker → coworker accepts → manager approves (unless self-approval applies).
- Business setting per type: requires manager approval yes/no.
- Original employee stays responsible for the shift until the change is approved.

**Concurrency.** Claiming an open shift happens inside a transaction using a conditional update (`UPDATE ... WHERE membershipId IS NULL`); zero affected rows means "already taken" and is shown as a clear message, not an error. A partial unique index enforces at most one pending-or-approved claim per shift. Ship a test that fires ten simultaneous claims and asserts exactly one winner. Staff genuinely do all tap at once, because they all received the same notification.

### 6.4 Approval re-checks published shifts

Approving **any** availability change or time-off request re-runs the conflict check across all **published future shifts**. Each conflict raises a `SCHEDULE_CONFLICT` item on the manager dashboard, listing the affected shift with *Reassign* / *Make open* / *Keep anyway* actions.

Without this, approving someone's Wednesday off while they are already on the published Wednesday schedule creates a conflict that nobody is told about, and both parties assume the other has handled it.

---

## 7. Time Clock (most important feature)

### 7.1 Clocking
- Actions: **Clock in → Start break → End break → Clock out.**
- Employee enters their **PIN**.
- Two modes (business setting, can use both):
  - **Personal phone:** employee is logged in; PIN confirms the punch.
  - **Kiosk mode:** shared tablet at the location; employee taps their name, enters PIN.
- **PIN storage:** HMAC-SHA256 with a server secret — never plain text. PIN is scoped **per membership**, not per user, so leaving one employer never exposes a credential at another. Lock after 5 wrong attempts for 5 minutes; log attempts. Employee can change their PIN (requires password or magic-link re-auth); managers can reset it.

**Kiosk devices have their own identity.** A kiosk must not run on a manager's user session — that session expires overnight, dies when the manager is deactivated, and leaves a manager account open on a counter in a public room. Instead:
- A manager **enrols** the device once, producing a long-lived `KioskDevice` token bound to `businessId + locationId`.
- That token's only capabilities are *list active staff names* and *submit a punch*. It can read nothing else.
- Leaving kiosk mode requires a manager PIN or password, never a back button.
- Tokens are listed in settings with last-seen time, and individually revocable.

**Multi-business clocking.** Where a user has more than one active membership, the clock defaults to the business whose shift starts soonest and offers an explicit switcher. The employee gets a personal *All my hours* view that crosses businesses. **No manager ever gets cross-business visibility** — add an isolation test proving that one business cannot discover that the other exists.

**Offline punches.** The service worker queues punches locally with the device timestamp and the last known GPS fix, and syncs on reconnect. A restaurant loses its connection at exactly the wrong moment routinely, and the fallback — reconstructing four start times from memory the next day — is the paperwork this product exists to remove.
- Every queued punch arrives flagged `OFFLINE_QUEUED`, stores **both** device time and server receipt time, and is provisional until a manager confirms it.
- Reject any queued punch whose device time is more than `maxClockSkewMinutes` (default 30) ahead of server time.

### 7.2 Geofence
- Each location has a centre (lat/lng, set by map pin or "use my current position") and **radius** in metres (default 100 m).
- Setting per location: geofence **required / warn only / off**.
- On punch, request browser geolocation (HTTPS only). If permission is denied, explain how to enable it; the punch is refused when geofence is required.
- Server checks distance (haversine) — **never trust a client-side "inside" flag.** Store lat, lng and accuracy on every punch.
- **Poor accuracy accepts, never refuses.** Where reported `accuracy > radius`, the punch is **accepted and flagged** `GEO_UNCERTAIN`. A basement kitchen can report 120 m accuracy against an 80 m radius, which would otherwise reject honest punches from inside the building while accepting one from the pavement outside.
- **Offsite work.** A shift may carry `geofenceOverride`: either *off*, or a temporary centre and radius set when the shift is created. Punches under an override are flagged `OFFSITE` and record the captured position. Catering, deliveries, markets and a second kitchen during a renovation are normal restaurant work; without this the only escape is manual entry, which trains managers to treat hand-edited time as routine.
- **Test geofence** button in location settings: records ten readings from where staff actually stand and recommends a radius.
- Kiosk punches skip GPS (the device is registered to the location) — record `source = kiosk`.
- Note in README: browser GPS can be faked; flags and audit are the mitigation, not prevention.

### 7.3 Rules (configurable per business)
- Allow clock-in up to X minutes before scheduled start (default 10).
- Allow/flag unscheduled clock-ins.
- **Rounding: default none.** Where enabled, round clock-in **down** and clock-out **up** (to the employee's benefit), or apply true nearest-interval rounding. Always retain the raw timestamp alongside the rounded one. Asymmetric rounding systematically shaves paid time, so the settings screen states plainly that this is the owner's legal risk.
- Late / no-show detection against the schedule.

#### Missing clock-out — never invent a time

An employee who forgets to clock out has *not* necessarily worked until their scheduled end. People stay late for real reasons. Closing the entry automatically at the scheduled end time silently deletes that extra time, so the app does not do it.

1. The entry stays **open**. No end time is ever written automatically.
2. After `maxShiftHours` past clock-in, flag it `MISSING_CLOCK_OUT`, **exclude it from live Scheduled-wages figures and from "who is working now"**, and notify the employee and managers **immediately** — while the real finish time is still in someone's memory.
3. **The employee cannot clock in again until it is answered.** On their next clock-in attempt, the clock screen asks for the finish time of the previous shift first. Their answer is recorded as an employee-submitted correction request (§7.4), not as a punch.
4. A user with `timeclock.edit` confirms or amends it, with a reason, as a normal audited correction.
5. Until confirmed, the entry is **not payable** and blocks timesheet approval (§7.7).

The same applies in reverse to a clock-out with no clock-in.

### 7.4 Corrections
- Users with `timeclock.edit` can edit times; `timeclock.add` can add a missing entry.
- **Reason is mandatory.** Every change creates an immutable audit record (who, when, before, after, reason). Original values are never lost.
- Employee is notified when their time is edited and can see the full history themselves.
- Employees can **request a correction** ("I forgot to clock out at 22:00") → goes to approvers.
- **Nobody edits their own entries** (§3.3), regardless of rank or self-approval settings.

### 7.5 Timesheets & pay
- Pay period: weekly / bi-weekly / semi-monthly / monthly (business setting).
- Timesheet per employee per period: regular hours, overtime hours, break time, holiday hours and pay, vacation accrual, estimated gross pay.
- Approve timesheet → locks the period (edits after lock require Owner and are audited).
- **CSV export** for payroll.
- All arithmetic is governed by **§7.6**. Implement that section first.

---

## 7.6 Pay calculation rules

> This section and §7.7 are the highest-risk part of the build. Everything here fails *silently* — a wrong rule produces a clean, plausible CSV that nobody checks until someone is underpaid. Build these with their unit tests **before** any timesheet screen exists.

### 7.6.1 Which day, which period

1. A time entry belongs, **whole and undivided**, to the pay period and work-day containing its **clock-in**. It is never split at midnight.
2. `Business.workDayStart` (default **04:00** local) defines the work-day boundary for daily overtime, so a 21:00–02:10 close counts entirely as the day it started.
3. This single rule decides both the pay period and the day used for daily overtime. Three answers were defensible; this is the one the app uses everywhere.

### 7.6.2 Overtime

Configurable per business: daily threshold, daily second threshold, weekly threshold, and a multiplier for each. Seeded presets per province, editable, with a visible note that the owner is responsible for matching current local employment law.

**Order of operations is mandatory and is not left to the implementation:**

1. Compute **daily** overtime per work-day. Mark those hours **consumed**.
2. Sum only the **remaining** (non-consumed) hours for the week, and apply the weekly threshold to those.
3. Where tiers overlap, apply the **higher multiplier once**. Never both.

Without this stated, hours already paid as daily overtime get counted again toward the weekly total and paid twice. Two reasonable developers implement it two different ways and only one is right.

**Required unit test, with the expected split written into the test:** a 12-hour day inside a 46-hour week.

### 7.6.3 Breaks

- **Actual break punches are authoritative for pay.**
- `Shift.breakMinutes` is a **planning figure only** and is **never deducted** from pay. v1 stored both numbers and never said which one wins: deducting the planned break underpays anyone who worked through it, and using only punches overpays anyone who forgets to punch back in.
- `BreakRule` per business: *after N consecutive hours, a break of M minutes is required*, and whether it is paid when not taken.
- Where the rule is not satisfied, raise `BREAK_MISSED` on the entry, notify the manager, and require a resolution — *break was taken, add it* / *break was missed, pay it* — before the timesheet can be approved.

### 7.6.4 Statutory holidays

Absent from v1 entirely. Two separate amounts are owed and neither was being calculated.

- `Holiday` (businessId, date, name, isStatutory, premiumMultiplier, eligibilityRule), seeded per country/province and editable by `holidays.manage`.
- `HolidayEntitlement` rows generated per employee per holiday:
  - **Worked the holiday** → premium hours at the configured multiplier, in addition to the normal calculation.
  - **Did not work** → an average-day's-pay entitlement, subject to the configured eligibility test (typically based on length of employment and days worked in the preceding period).
- The verdict must show **the inputs that produced it**, not just eligible/not eligible, plus a manual override carrying a reason.
- Holidays appear on the schedule grid (§5) and as their own columns in the payroll CSV.

### 7.6.5 Vacation pay

Also absent from v1. Vacation pay accrues as a percentage of gross earnings and must be tracked continuously — it cannot be reconstructed accurately at year end.

- `Business.vacationPayPercent`.
- Per approved timesheet: `vacationAccrued = grossWages × percent`.
- Running `vacationBalance` per employee, with manual adjustment carrying a reason.
- Accrual and balance are their own CSV columns.

### 7.6.6 Minimum daily pay and split shifts

- `minimumDailyPayHours` — where an employee reported for work but actual worked hours fall below this, pay the minimum. Off by default outside seeded presets.
- `maxSplitShiftSpanHours` — raise a scheduling warning (§5.1) when two same-day shifts for one person span more than this from first start to last end.

### 7.6.7 Approval gate

**Timesheet approval is blocked while any entry in the period carries an unresolved blocking flag** (§7.7). The approval screen shows the count and links straight to them.

An Owner may *approve with exceptions*; each unresolved flag is then written individually to the audit log. Without this gate, flags are decorative: a manager approves at 23:50 on the last night, the period locks, and fixing anything afterwards requires Owner intervention on a locked period.

### 7.6.8 Pay rules settings screen

All of the above live on **one** settings screen called **Pay rules**, gated by `payrules.manage`. It states plainly at the top that these values are the owner's responsibility and that the app calculates what it is told to calculate. Seeded presets are a starting point the owner confirms. **The app must never claim compliance on the owner's behalf**, in the UI, in the docs or in marketing copy.

### 7.6.9 Required tests

Each of these has its expected values written into the test file:

- 12-hour day inside a 46-hour week (overtime order of operations)
- Entry crossing the pay-period boundary (21:00 Sunday → 02:10 Monday)
- Entry crossing a DST transition — elapsed hours must match wall-clock reality, not naive arithmetic
- Shift crossing midnight with `workDayStart` at 04:00
- Statutory holiday worked, and not worked, for an eligible and an ineligible employee
- Vacation accrual on an approved timesheet
- Approval blocked by each blocking flag in turn

---

## 7.7 Time entry flags

One vocabulary, one queue (**Unresolved time**), one effect on approval.

| Flag | Blocks approval | Raised when |
|---|---|---|
| `MISSING_CLOCK_OUT` | Yes | Clock-in with no clock-out past `maxShiftHours` (§7.3) |
| `MISSING_CLOCK_IN` | Yes | Clock-out with no matching clock-in |
| `BREAK_MISSED` | Yes | Required break not punched within the rule window |
| `OFFLINE_QUEUED` | Yes | Punch queued on device and synced later |
| `GEO_UNCERTAIN` | No | Reported accuracy exceeds the geofence radius — accepted, flagged |
| `GEO_OUTSIDE` | No | Accepted under *warn only* mode while outside the fence |
| `OFFSITE` | No | Punch made under a shift-level geofence override |
| `UNSCHEDULED` | No | No matching scheduled shift |
| `LATE` / `EARLY_LEAVE` | No | Punch deviates from schedule beyond tolerance |

Blocking flags are cleared only by an explicit human resolution, which is recorded as a normal audited correction (§7.4).

---

## 8. Wages

- Hourly wage per employee, optionally **per position** (e.g. $18 server, $20 bar).
- Salaried option (no hourly calc, excluded from overtime).
- Wage **history** with effective-from date — changing a wage never rewrites past timesheets. A raise dated mid-period must leave the current period calculating at the old rate throughout.
- Currency from business settings.

---

## 9. Messaging & Notifications

- **Direct messages** (1:1) and **group chats**. Auto-groups per location and per position, optional.
- **Announcements** (`messages.broadcast`): to all, a location, a role or a position; optional "require read confirmation".
- Unread counts, read receipts on announcements, image attachments (max 5 MB, stored locally in dev / S3-compatible in prod behind an interface).
- Employees can mute chats. Deactivated employees lose access immediately (§11).

### 9.1 Notification batching

Taken literally, "publishing notifies staff and editing a published shift notifies the affected employee" means an evening of tidying generates dozens of emails. Staff mute the app within a fortnight, and then miss the message that matters. **Adoption dies here more often than it dies on features.**

- Queue notifications and flush per user on a debounce (default **10 minutes**), collapsing to **one message per person per publish event**: *"Your week of 5 Oct changed: Tue 17:00→17:15, Thu shift added."*
- Send the schedule-published message **only to staff whose own shifts changed**.
- Every shift-change notification carries a **before → after diff**, in the payload and in the text. "Your shift on Thursday was updated" is not enough for someone who has arranged childcare around the old time.
- In-app bell always on; email opt-out per notification type. Web push later — leave the interface ready.

---

## 10. Other Screens

- **Dashboard (manager):** who is working now, who is late, pending requests, **Unresolved time** count (§7.7), schedule conflicts (§6.4), bounced invitations (§4.2), this week's Scheduled wages.
- **Dashboard (employee):** next shift, clock button, pending requests, unread messages.
- **Employee directory:** contact info visible per business setting. **Addresses and DOB only visible to managers with `employees.edit`.**
- **Reports** (`reports.view`): hours by employee, wages by day/location/position, attendance (late, no-show, missing punches), time-off summary, holiday entitlements. All exportable to CSV.
- **Settings:** business, locations, geofences, positions, roles & permissions, request rules, time clock rules, **Pay rules (§7.6.8)**, kiosk devices, notification defaults.
- **Platform Admin area:** list businesses, create business + invite owner, suspend/reactivate, subscription status (`trial`, `active`, `past_due`, `cancelled`) — billing integration out of scope.
- **Account:** profile, PIN change, password, notification preferences, businesses I belong to, **export my data**, request account deletion.

### 10.1 Data export payload

A naive "export my data" walks the user's conversations and ships every message in them — including everything colleagues and managers wrote, and every group thread the user was ever added to. A departing employee can export the management group chat on their way out.

The export contains, explicitly:
- their own profile, memberships, wage history, shifts, requests, time entries, and audit records concerning them;
- **only messages they themselves sent.**

Received messages appear as metadata only — conversation, timestamp, sender — with no body text. Exports are rate-limited and written to the audit log.

---

## 11. Non-Functional Requirements

- **Mobile:** works at 360–430 px; bottom tab bar (Schedule, Clock, Requests, Messages, More); touch targets ≥ 44 px; no horizontal scroll; forms usable with one thumb.
- **Accessibility:** WCAG 2.1 AA basics (labels, contrast, keyboard navigation).
- **Security:** rate-limit login, magic link, invitations and PIN attempts; secure cookies; CSRF protection; Zod validation; audit log for sensitive actions (roles, wages, time edits, self-approvals, deactivations, exports).
- **Privacy:** collect only what is listed. Do **not** collect government ID or social insurance numbers.
- **Leaving employment — two independent fields.** `accessRevokedAt` (sessions killed, PIN disabled, messaging and schedule access gone immediately) and `employmentEndedAt` (the payroll date). Deactivated staff remain **fully visible in timesheets, reports and exports** for any period overlapping their employment, or they do not get their last cheque. Add a **Final timesheet** action that closes out a partial period on demand.
- **Performance:** schedule week view for 50 employees loads < 2 s on a mid-range phone.
- **Timezones & DST:** tests for shifts crossing midnight and DST changes (§7.6.9).
- **Seed script:** 1 platform admin, 2 businesses, 2 locations, all roles, 12 employees with wages/PINs, 2 weeks of shifts, a statutory holiday inside the period, sample requests, messages, clock entries, and at least one entry carrying each blocking flag. Print seed logins in README.

---

## 12. Build Phases (do in order, commit after each)

- [ ] **Phase 1 — Foundation:** project setup, Docker Postgres, Prisma schema, auth, multi-tenant data-access layer + isolation tests, layout with mobile nav, i18n, dev email fallback.
- [ ] **Phase 2 — Onboarding:** platform admin, create business, invitations (owner + employee, with bounce handling), profile completion, PIN setup, roles & permissions UI.
- [ ] **Phase 3 — Locations, positions & wages:** settings screens, geofence picker and test tool, wage history.
- [ ] **Phase 4 — Scheduling:** shifts, open shifts, draft/publish, templates, copy week, persistent warnings, Scheduled wages, .ics feed.
- [ ] **Phase 5 — Requests:** shared eligibility predicate, time off, blackout dates, availability, drop/pickup/swap with concurrency test, approvals, published-shift re-check.
- [ ] **Phase 6 — Time clock:** punches, breaks, geofence check, offline queue, kiosk devices, missing-punch flow, corrections + audit.
- [ ] **Phase 7 — Pay rules first, then timesheets:**
  - [ ] **7a.** Implement §7.6 and §7.7 as pure, tested functions with **no UI at all**. Every test in §7.6.9 passes before 7b starts.
  - [ ] **7b.** Pay periods, timesheet screens, approval gate, locking, CSV export, reports, dashboards.
- [ ] **Phase 8 — Messaging:** DMs, groups, announcements, unread counts, notification batching, preferences.
- [ ] **Phase 9 — Polish:** PWA, accessibility pass, empty states, loading/error states, data export payload, full e2e run on mobile + desktop, README.

### Definition of done (per phase)
- Typecheck, lint, all tests pass.
- Every new screen tested in Playwright at 375 px.
- Permission checks covered by unit tests (allowed **and** denied case).
- `PROGRESS.md` updated, committed.

---

## 13. Data Model

`User`, `Business` (+ `allowSelfTimeOffApproval`, `minorAgeThreshold`, `workDayStart`, `vacationPayPercent`, `burdenPercent`, `maxClockSkewMinutes`, `escalateAfterHours`), `Location` (timezone, lat, lng, radiusM, geofenceMode, `isTemporary`), `Membership` (user↔business, roleId, status, hireDate, `accessRevokedAt`, `employmentEndedAt`), `Role` (rank, permissions JSON, isSystem), `EmployeeProfile` (phone, dob, address, emergencyContact, pinHmac, pinFailedAttempts, pinLockedUntil), `Position` (+ `requiresMinimumAge`), `MembershipPosition`, `MembershipLocation`, `Wage` (membershipId, positionId?, rate, type, effectiveFrom), `Invitation` (email, name, roleId, tokenHash, expiresAt, status, `deliveryStatus`), `Shift` (locationId, positionId, membershipId?, startsAt, endsAt, breakMinutes, status, notes, `geofenceOverride`), `ShiftTemplate`, `AvailabilityRule`, `TimeOffRequest`, `BlackoutPeriod`, `ShiftTradeRequest`, `TimeEntry` (clockIn/Out, lat/lng/accuracy in & out, source, deviceTime, serverTime), **`TimeEntryFlag`**, `BreakEntry`, **`BreakRule`**, `TimeEntryAudit`, `CorrectionRequest`, `PayPeriod`, `Timesheet`, **`Holiday`**, **`HolidayEntitlement`**, **`VacationAccrual`**, `Conversation`, `ConversationMember`, `Message`, `Announcement`, `AnnouncementRead`, `Notification`, `NotificationPreference`, **`KioskDevice`**, `AuditLog`, `EmailLog`.

Bold entries are new in v2. Adjust as needed, recording changes in `DECISIONS.md`.

---

## 14. Out of Scope for This Run

- Subscription billing (Stripe) — status field only
- Deployment of any kind (Rule 9)
- Native iOS/Android apps (PWA only)
- SMS notifications
- Payroll provider / POS integrations
- Auto-scheduling / AI schedule suggestions
- Tip pooling and tip-out

---

## 15. Before Starting (for the human, not for Claude Code)

- [ ] Empty GitHub repo with this `Spec.md`, an empty `DECISIONS.md` and `PROGRESS.md`
- [ ] Codespace with Docker available — **raise the idle timeout as far as it goes** before starting an overnight run
- [ ] `.env` from `.env.example` (no `RESEND_API_KEY` needed; the dev fallback covers it)
- [ ] Morning: read `PROGRESS.md` → `DECISIONS.md` → review commits phase by phase
- [ ] Morning: run the §7.6.9 tests yourself and read the expected values. That is the part most worth your own eyes.
