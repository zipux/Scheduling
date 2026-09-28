// Permission keys and pure authorization rules (Spec §3). No I/O here, so every
// rule is unit-testable for both the allowed and the denied case.

export const PERMISSIONS = [
  "business.settings",
  "roles.manage",
  "employees.invite",
  "employees.edit",
  "wages.view",
  "wages.edit",
  "schedule.edit",
  "schedule.publish",
  "timeoff.approve",
  "availability.approve",
  "trades.approve",
  "blackout.manage",
  "holidays.manage",
  "timeclock.edit",
  "timeclock.add",
  "timesheets.approve",
  "payrules.manage",
  "reports.view",
  "messages.broadcast",
  "locations.scope_all",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

export function parsePermissions(json: unknown): Permission[] {
  return Array.isArray(json) ? json.filter(isPermission) : [];
}

const MANAGER: Permission[] = [
  "employees.invite",
  "employees.edit",
  "wages.view",
  "schedule.edit",
  "schedule.publish",
  "timeoff.approve",
  "availability.approve",
  "trades.approve",
  "blackout.manage",
  "timeclock.edit",
  "timeclock.add",
  "timesheets.approve",
  "reports.view",
  "messages.broadcast",
];

export const DEFAULT_ROLES: { key: string; name: string; rank: number; isOwner: boolean; permissions: Permission[] }[] = [
  { key: "owner", name: "Owner", rank: 1, isOwner: true, permissions: [...PERMISSIONS] },
  {
    key: "general_manager",
    name: "General Manager",
    rank: 2,
    isOwner: false,
    permissions: PERMISSIONS.filter((p) => p !== "roles.manage" && p !== "payrules.manage"),
  },
  { key: "manager", name: "Manager", rank: 3, isOwner: false, permissions: MANAGER },
  {
    key: "assistant_manager",
    name: "Assistant Manager",
    rank: 4,
    isOwner: false,
    permissions: [
      "schedule.edit",
      "schedule.publish",
      "timeoff.approve",
      "availability.approve",
      "trades.approve",
      "timeclock.edit",
      "timeclock.add",
      "messages.broadcast",
    ],
  },
  { key: "shift_lead", name: "Shift Lead / Supervisor", rank: 5, isOwner: false, permissions: ["trades.approve"] },
  { key: "employee", name: "Employee", rank: 6, isOwner: false, permissions: [] },
];

/** The minimal facts about an actor that authorization decisions depend on. */
export interface Actor {
  userId: string;
  membershipId: string;
  isOwner: boolean;
  rank: number;
  permissions: ReadonlySet<Permission>;
}

export interface Target {
  membershipId: string;
  rank: number;
}

export function can(actor: Actor, perm: Permission): boolean {
  return actor.isOwner || actor.permissions.has(perm);
}

/**
 * §3.3: a user may act for people of lower rank only, unless they are Owner.
 * Acting on yourself is NOT covered here — see canApproveOwnRequest / canEditTimeEntry.
 */
export function outranks(actor: Actor, target: Target): boolean {
  if (actor.membershipId === target.membershipId) return false;
  return actor.isOwner || actor.rank < target.rank;
}

export type RequestPermission = "timeoff.approve" | "availability.approve" | "trades.approve";

/**
 * May `actor` review a request of type `perm` belonging to `requester`?
 * Self-approval is allowed only via Business.allowSelfTimeOffApproval (§3.3); the
 * caller must write a SELF_APPROVED audit record when `self` is true.
 */
export function canReviewRequest(
  actor: Actor,
  requester: Target,
  perm: RequestPermission,
  allowSelfApproval: boolean,
): { allowed: boolean; self: boolean } {
  if (!can(actor, perm)) return { allowed: false, self: false };
  if (actor.membershipId === requester.membershipId) {
    return { allowed: allowSelfApproval, self: true };
  }
  return { allowed: outranks(actor, requester), self: false };
}

/**
 * §3.3 / §7.4: nobody may ever edit their own time entries — absolute, no setting,
 * regardless of rank or Owner status.
 */
export function canEditTimeEntry(
  actor: Actor,
  entryOwner: Target,
  perm: "timeclock.edit" | "timeclock.add",
): boolean {
  if (actor.membershipId === entryOwner.membershipId) return false;
  return can(actor, perm) && outranks(actor, entryOwner);
}

/** §3.3: employees always see their own wage; others only with wages.view. */
export function canViewWage(actor: Actor, subjectMembershipId: string): boolean {
  return actor.membershipId === subjectMembershipId || can(actor, "wages.view");
}

/** Editing another person's profile/wage/role requires the permission AND seniority. */
export function canManagePerson(actor: Actor, target: Target, perm: Permission): boolean {
  return can(actor, perm) && outranks(actor, target);
}
