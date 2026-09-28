import "server-only";
import { rawDb } from "@/server/db/client";

/** Number of businesses a user can currently use. Cross-tenant by design; returns a count only. */
export function activeMembershipCount(userId: string) {
  return rawDb.membership.count({
    where: { userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
  });
}

/** Businesses/locations where this user may enrol a kiosk (timeclock.edit). The user's own memberships only. */
export async function enrolmentOptions(userId: string) {
  const ms = await rawDb.membership.findMany({
    where: { userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
    include: { role: true, business: true, locations: { include: { location: true } } },
  });
  const out = [];
  for (const m of ms) {
    const perms = Array.isArray(m.role.permissions) ? (m.role.permissions as string[]) : [];
    if (!m.role.isOwner && !perms.includes("timeclock.edit")) continue;
    const all = m.role.isOwner || perms.includes("locations.scope_all");
    const locations = all
      ? await rawDb.location.findMany({ where: { businessId: m.businessId, archivedAt: null }, orderBy: { name: "asc" } })
      : m.locations.map((l) => l.location).filter((l) => !l.archivedAt);
    if (locations.length) out.push({ businessId: m.businessId, businessName: m.business.name, locations: locations.map((l) => ({ id: l.id, name: l.name })) });
  }
  return out;
}

/** For /clock: the business whose next shift for this user starts soonest (§7.1 multi-business clocking). */
export async function soonestShiftBusiness(userId: string) {
  const ms = await rawDb.membership.findMany({
    where: { userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
    select: { id: true, businessId: true },
  });
  if (!ms.length) return null;
  const s = await rawDb.shift.findFirst({
    where: { membershipId: { in: ms.map((m) => m.id) }, status: "published", deletedAt: null, endsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { businessId: true },
  });
  return s?.businessId ?? ms[0].businessId;
}

/** "All my hours": the user's OWN time entries across their businesses. Never exposed to managers. */
export async function myHoursAcrossBusinesses(userId: string, days = 28) {
  const ms = await rawDb.membership.findMany({ where: { userId }, select: { id: true, business: { select: { name: true, timezone: true } } } });
  const since = new Date(Date.now() - days * 86400_000);
  const entries = await rawDb.timeEntry.findMany({
    where: { membershipId: { in: ms.map((m) => m.id) }, OR: [{ clockIn: { gte: since } }, { clockIn: null, clockOut: { gte: since } }] },
    include: { breaks: true, location: { select: { name: true, timezone: true } } },
    orderBy: { clockIn: "desc" },
  });
  const biz = new Map(ms.map((m) => [m.id, m.business.name]));
  return entries.map((e) => ({ ...e, businessName: biz.get(e.membershipId) ?? "" }));
}
