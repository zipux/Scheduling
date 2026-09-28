import { rawDb } from "./client";

/**
 * Multi-tenant data-access layer (Spec §3.3).
 *
 * `tenantDb(businessId)` returns a Prisma client in which every query is forced
 * into one business:
 *   - reads/updates/deletes get `businessId` added to `where`;
 *   - creates get `businessId` written into `data` (a conflicting value throws);
 *   - every foreign-key-like field in written data (membershipId, locationId, …)
 *     is verified to point at a row of the same business;
 *   - nested relation writes are refused (they would bypass the checks above);
 *   - `User` is read-only and restricted to members of this business, and may
 *     not be traversed back out to other memberships/sessions/accounts;
 *   - auth tables are unreachable.
 *
 * The isolation test (tests/integration/tenant-isolation.test.ts) proves a
 * client for business A can neither read nor write business B, and a unit test
 * keeps the model lists below in sync with prisma/schema.prisma.
 */

/** Models that carry a `businessId` column. */
export const TENANT_MODELS = [
  "Location",
  "Role",
  "Membership",
  "EmployeeProfile",
  "PinAttempt",
  "Position",
  "MembershipPosition",
  "MembershipLocation",
  "Wage",
  "Invitation",
  "Shift",
  "ShiftTemplate",
  "AvailabilityRule",
  "TimeOffRequest",
  "BlackoutPeriod",
  "ShiftTradeRequest",
  "ScheduleConflict",
  "KioskDevice",
  "TimeEntry",
  "TimeEntryFlag",
  "BreakEntry",
  "BreakRule",
  "TimeEntryAudit",
  "CorrectionRequest",
  "PayRules",
  "PayPeriod",
  "Timesheet",
  "Holiday",
  "HolidayEntitlement",
  "VacationAccrual",
  "Conversation",
  "ConversationMember",
  "Message",
  "Announcement",
  "AnnouncementRead",
  "Notification",
  "NotificationPreference",
  "AuditLog",
  "EmailLog",
] as const;

/** Models that must never be reached through a tenant client. */
export const FORBIDDEN_MODELS = ["Session", "Account", "Verification", "RateLimit"] as const;

/** Relation (object) fields per model — used to refuse nested writes. Kept in sync by a unit test. */
export const RELATION_FIELDS: Record<string, readonly string[]> = {
  User: ["sessions", "accounts", "memberships"],
  Session: ["user"],
  Account: ["user"],
  Business: ["locations", "memberships", "roles", "positions", "invitations", "payRules", "breakRules", "holidays", "kioskDevices"],
  Location: ["business", "memberships", "shifts"],
  Role: ["business", "memberships", "invitations"],
  Membership: ["business", "user", "role", "profile", "locations", "positions", "wages", "shifts"],
  EmployeeProfile: ["membership"],
  Position: ["business", "memberships", "shifts"],
  MembershipPosition: ["membership", "position"],
  MembershipLocation: ["membership", "location"],
  Wage: ["membership"],
  Invitation: ["business", "role"],
  Shift: ["location", "position", "membership"],
  KioskDevice: ["business"],
  TimeEntry: ["breaks", "flags"],
  TimeEntryFlag: ["timeEntry"],
  BreakEntry: ["timeEntry"],
  BreakRule: ["business"],
  PayRules: ["business"],
  Holiday: ["business"],
  Conversation: ["members", "messages"],
  ConversationMember: ["conversation"],
  Message: ["conversation"],
  Announcement: ["reads"],
  AnnouncementRead: ["announcement"],
};

/** Scalar reference fields → the tenant model they must point into. */
export const REFERENCE_FIELDS: Record<string, (typeof TENANT_MODELS)[number]> = {
  membershipId: "Membership",
  fromMembershipId: "Membership",
  toMembershipId: "Membership",
  senderMembershipId: "Membership",
  locationId: "Location",
  preferredLocationId: "Location",
  positionId: "Position",
  roleId: "Role",
  shiftId: "Shift",
  swapShiftId: "Shift",
  timeEntryId: "TimeEntry",
  conversationId: "Conversation",
  announcementId: "Announcement",
  holidayId: "Holiday",
  payPeriodId: "PayPeriod",
  timesheetId: "Timesheet",
  kioskDeviceId: "KioskDevice",
};

const ARRAY_REFERENCE_FIELDS: Record<string, (typeof TENANT_MODELS)[number]> = {
  locationIds: "Location",
  positionIds: "Position",
};

// Fields that share a name with a reference but point elsewhere, per model.
const REFERENCE_EXCEPTIONS: Record<string, readonly string[]> = {};

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(`Tenant isolation: ${message}`);
    this.name = "TenantViolationError";
  }
}

const tenantSet = new Set<string>(TENANT_MODELS);
const forbiddenSet = new Set<string>(FORBIDDEN_MODELS);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const DATA_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn"]);

type Row = Record<string, unknown>;

const USER_PRIVATE = new Set(["memberships", "sessions", "accounts"]);

/** Refuse include/select paths that leave the tenant through User. */
function assertSafeNesting(node: unknown, insideUser: boolean, path: string) {
  if (!node || typeof node !== "object") return;
  for (const key of ["include", "select"] as const) {
    const sel = (node as Record<string, unknown>)[key];
    if (!sel || typeof sel !== "object") continue;
    for (const [field, value] of Object.entries(sel as Record<string, unknown>)) {
      if (insideUser && USER_PRIVATE.has(field) && value) {
        throw new TenantViolationError(`cannot traverse user.${field} (${path})`);
      }
      if (field === "_count" && insideUser) {
        throw new TenantViolationError(`cannot count user relations (${path})`);
      }
      assertSafeNesting(value, field === "user" || field === "users", `${path}.${field}`);
    }
  }
}

/**
 * Adds `field = value` to a where clause. If the caller already constrained the
 * same field, both conditions must hold (AND) — the caller's filter is never
 * silently replaced, so asking for another business's row matches nothing.
 */
function scopeWhere(where: unknown, field: string, value: string) {
  const w = { ...((where as Row) ?? {}) };
  const callerValue = w[field];
  const out: Row = { ...w, [field]: value };
  if (callerValue !== undefined && callerValue !== value) {
    const and = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
    out.AND = [...and, { [field]: callerValue }];
  }
  return out;
}

function withBusinessWhere(where: unknown, businessId: string) {
  return scopeWhere(where, "businessId", businessId);
}

export function tenantDb(businessId: string) {
  if (!businessId || typeof businessId !== "string") {
    throw new TenantViolationError("businessId is required");
  }

  async function assertReferences(model: string, data: Row) {
    const checks: { model: string; ids: string[]; field: string }[] = [];
    for (const [field, value] of Object.entries(data)) {
      if (REFERENCE_EXCEPTIONS[model]?.includes(field)) continue;
      const target = REFERENCE_FIELDS[field];
      if (target && typeof value === "string") checks.push({ model: target, ids: [value], field });
      const arrTarget = ARRAY_REFERENCE_FIELDS[field];
      if (arrTarget && Array.isArray(value) && value.length) {
        checks.push({ model: arrTarget, ids: value as string[], field });
      }
      if (RELATION_FIELDS[model]?.includes(field) && value !== undefined) {
        throw new TenantViolationError(`nested relation write on ${model}.${field} is not allowed`);
      }
    }
    for (const c of checks) {
      const delegate = (rawDb as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[
        lowerFirst(c.model)
      ];
      const unique = [...new Set(c.ids)];
      const n = await delegate.count({ where: { id: { in: unique }, businessId } });
      if (n !== unique.length) {
        throw new TenantViolationError(`${model}.${c.field} references a ${c.model} outside this business`);
      }
    }
  }

  return rawDb.$extends({
    name: "tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as Row;
          assertSafeNesting(a, model === "User", model);

          if (forbiddenSet.has(model)) {
            throw new TenantViolationError(`${model} is not reachable from a tenant client`);
          }

          if (model === "Business") {
            if (!WHERE_OPS.has(operation) || operation.startsWith("delete")) {
              throw new TenantViolationError(`Business.${operation} is not allowed from a tenant client`);
            }
            if (a.data && (a.data as Row).id !== undefined) throw new TenantViolationError("cannot change Business.id");
            if (a.data) await assertReferences("Business", a.data as Row);
            return query({ ...a, where: scopeWhere(a.where, "id", businessId) } as typeof args);
          }

          if (model === "User") {
            if (!READ_OPS.has(operation)) {
              throw new TenantViolationError(`User.${operation} is not allowed from a tenant client`);
            }
            const w = { ...((a.where as Row) ?? {}) };
            const and = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
            return query({
              ...a,
              where: { ...w, AND: [...and, { memberships: { some: { businessId } } }] },
            } as typeof args);
          }

          if (!tenantSet.has(model)) {
            throw new TenantViolationError(`unknown model ${model}`);
          }

          const next: Row = { ...a };

          if (WHERE_OPS.has(operation)) next.where = withBusinessWhere(a.where, businessId);

          if (DATA_OPS.has(operation) && a.data !== undefined) {
            const rows = Array.isArray(a.data) ? (a.data as Row[]) : [a.data as Row];
            const out: Row[] = [];
            for (const row of rows) {
              if (row.businessId !== undefined && row.businessId !== businessId) {
                throw new TenantViolationError(`${model}.businessId mismatch`);
              }
              await assertReferences(model, row);
              out.push(CREATE_OPS.has(operation) ? { ...row, businessId } : row);
            }
            next.data = Array.isArray(a.data) ? out : out[0];
          }

          if (operation === "upsert") {
            next.where = withBusinessWhere(a.where, businessId);
            const create = (a.create ?? {}) as Row;
            const update = (a.update ?? {}) as Row;
            for (const row of [create, update]) {
              if (row.businessId !== undefined && row.businessId !== businessId) {
                throw new TenantViolationError(`${model}.businessId mismatch`);
              }
              await assertReferences(model, row);
            }
            next.create = { ...create, businessId };
          }

          return query(next as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
