import "server-only";
import { rawDb } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { hmacSha256Hex, randomToken, sha256Hex, timingSafeEqualHex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { parsePermissions } from "@/lib/permissions";
import { clockStatus, ClockError, punch, verifyPin, type PunchAction } from "@/server/services/clock";

/**
 * Kiosk devices (§7.1) have their own identity — never a manager's session.
 * A device token (stored hashed) is bound to businessId + locationId, and its
 * ONLY capabilities are: list active staff names, and submit a punch.
 */

export const KIOSK_COOKIE = "kiosk_token";
const TICKET_SECONDS = 90;

export async function createKioskDevice(businessId: string, locationId: string, name: string, enrolledById: string) {
  const token = randomToken(32);
  const device = await tenantDb(businessId).kioskDevice.create({
    data: { locationId, name, tokenHash: await sha256Hex(token), enrolledById } as never,
  });
  return { token, deviceId: device.id };
}

export type KioskDevice = { id: string; businessId: string; locationId: string; name: string };

/** Resolves a device token. Revoked devices, suspended businesses and disabled kiosk mode all fail. */
export async function authenticateKiosk(token: string | undefined): Promise<KioskDevice | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const d = await rawDb.kioskDevice.findUnique({ where: { tokenHash: await sha256Hex(token) }, include: { business: true } });
  if (!d || d.revokedAt || d.business.suspendedAt || !d.business.clockModeKiosk) return null;
  await rawDb.kioskDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
  return { id: d.id, businessId: d.businessId, locationId: d.locationId, name: d.name };
}

/** Capability 1: active staff names at this device's location. Nothing else. */
export async function kioskStaff(device: KioskDevice) {
  const db = tenantDb(device.businessId);
  const rows = await db.membershipLocation.findMany({
    where: { locationId: device.locationId, membership: { status: "active", accessRevokedAt: null } },
    include: { membership: { select: { id: true, displayName: true, user: { select: { name: true } } } } },
  });
  const location = await db.location.findUniqueOrThrow({ where: { id: device.locationId }, select: { name: true } });
  return {
    location: location.name,
    staff: rows.map((r) => ({ id: r.membership.id, name: r.membership.displayName ?? r.membership.user.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function assertAtLocation(device: KioskDevice, membershipId: string) {
  const ml = await tenantDb(device.businessId).membershipLocation.findFirst({ where: { membershipId, locationId: device.locationId } });
  if (!ml) throw new ClockError("NO_ACCESS", "This person isn't set up at this location.");
}

function ticketFor(device: KioskDevice, membershipId: string, exp: number) {
  return hmacSha256Hex(env().PIN_HMAC_SECRET, `kiosk:${device.id}:${membershipId}:${exp}`);
}

/**
 * PIN check, then a short-lived ticket so the chosen action doesn't need the PIN
 * typed twice. Returns only what the clock screen needs.
 */
export async function kioskIdentify(device: KioskDevice, membershipId: string, pin: string) {
  await assertAtLocation(device, membershipId);
  await verifyPin(tenantDb(device.businessId), membershipId, pin, "kiosk", device.id);
  const status = await clockStatus(device.businessId, membershipId);
  const exp = Math.floor(Date.now() / 1000) + TICKET_SECONDS;
  return {
    ticket: `${exp}.${await ticketFor(device, membershipId, exp)}`,
    clockedIn: !!status.open,
    onBreak: status.onBreak,
    needsPreviousFinish: !!status.needsPreviousFinish,
  };
}

/** Capability 2: submit a punch. */
export async function kioskPunch(device: KioskDevice, membershipId: string, ticket: string, action: PunchAction) {
  await assertAtLocation(device, membershipId);
  const [expRaw, mac] = ticket.split(".");
  const exp = Number(expRaw);
  if (!exp || exp < Date.now() / 1000 || !mac || !timingSafeEqualHex(mac, await ticketFor(device, membershipId, exp))) {
    throw new ClockError("PIN_WRONG", "Please enter your PIN again.");
  }
  return punch(
    { businessId: device.businessId, membershipId, source: "kiosk", kioskDeviceId: device.id, kioskLocationId: device.locationId },
    { action },
    { skipPin: true },
  );
}

/** Leaving kiosk mode needs a manager's PIN — never a back button (§7.1). */
export async function exitKiosk(device: KioskDevice, membershipId: string, pin: string) {
  const db = tenantDb(device.businessId);
  const m = await db.membership.findUnique({ where: { id: membershipId }, include: { role: true } });
  if (!m || m.status !== "active" || m.accessRevokedAt) throw new ClockError("NO_ACCESS", "Only a manager can leave kiosk mode.");
  const perms = parsePermissions(m.role.permissions);
  if (!m.role.isOwner && !perms.includes("timeclock.edit") && !perms.includes("business.settings")) {
    throw new ClockError("NO_ACCESS", "Only a manager can leave kiosk mode.");
  }
  await verifyPin(db, membershipId, pin, "kiosk-exit", device.id);
  await db.kioskDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
}
