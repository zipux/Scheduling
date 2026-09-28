"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { accessibleLocationIds, assertCan, requireBusinessAction } from "@/server/auth/context";
import { toResult, UserError, type ActionResult } from "@/server/action";
import { audit } from "@/server/audit";
import { ClockError } from "@/server/services/clock";
import { authenticateKiosk, createKioskDevice, exitKiosk, KIOSK_COOKIE, kioskIdentify, kioskPunch, kioskStaff } from "@/server/platform/kiosk";

type KioskResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function device() {
  const d = await authenticateKiosk((await cookies()).get(KIOSK_COOKIE)?.value);
  if (!d) throw new ClockError("NO_ACCESS", "This device is no longer enrolled as a kiosk.");
  return d;
}

function fail(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof ClockError) return { ok: false, error: err.message, code: err.code };
  return toResult(err);
}

/** Enrol this browser as a kiosk, then sign the manager out so no manager session stays on the counter. */
export async function enrolKioskAction(businessId: string, input: { locationId: string; name: string }): Promise<ActionResult> {
  try {
    const ctx = await requireBusinessAction(businessId);
    assertCan(ctx, "timeclock.edit");
    const v = z.object({ locationId: z.string().min(1), name: z.string().trim().min(1, "Name this device").max(60) }).parse(input);
    if (!(await accessibleLocationIds(ctx)).includes(v.locationId)) throw new UserError("Choose a location you manage.");
    if (!ctx.business.clockModeKiosk) throw new UserError("Kiosk mode is turned off in Settings → Business.");
    const { token, deviceId } = await createKioskDevice(businessId, v.locationId, v.name, ctx.userId);
    await audit({ businessId, actorUserId: ctx.userId, action: "KIOSK_ENROLLED", targetType: "KioskDevice", targetId: deviceId });
    const h = await headers();
    (await cookies()).set(KIOSK_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (h.get("x-forwarded-proto") ?? "http") === "https",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    });
    await auth.api.signOut({ headers: h });
    return { ok: true, data: undefined };
  } catch (err) {
    return toResult(err);
  }
}

export async function kioskStaffAction(): Promise<KioskResult<Awaited<ReturnType<typeof kioskStaff>>>> {
  try {
    return { ok: true, data: await kioskStaff(await device()) };
  } catch (err) {
    return fail(err);
  }
}

export async function kioskIdentifyAction(membershipId: string, pin: string): Promise<KioskResult<Awaited<ReturnType<typeof kioskIdentify>>>> {
  try {
    const v = z.object({ membershipId: z.string().min(1), pin: z.string().regex(/^\d{4,6}$/, "Enter your PIN") }).parse({ membershipId, pin });
    return { ok: true, data: await kioskIdentify(await device(), v.membershipId, v.pin) };
  } catch (err) {
    return fail(err);
  }
}

export async function kioskPunchAction(membershipId: string, ticket: string, action: string): Promise<KioskResult<{ flags: string[] }>> {
  try {
    const v = z.object({ membershipId: z.string().min(1), ticket: z.string().min(10).max(200), action: z.enum(["in", "break_start", "break_end", "out"]) }).parse({ membershipId, ticket, action });
    const r = await kioskPunch(await device(), v.membershipId, v.ticket, v.action);
    return { ok: true, data: { flags: r.flags } };
  } catch (err) {
    return fail(err);
  }
}

export async function exitKioskAction(membershipId: string, pin: string): Promise<KioskResult<null>> {
  try {
    const d = await device();
    await exitKiosk(d, membershipId, pin);
    (await cookies()).delete(KIOSK_COOKIE);
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
