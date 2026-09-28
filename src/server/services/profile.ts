import "server-only";
import { z } from "zod";
import { pinDigest } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { BusinessContext } from "@/server/auth/context";
import { sessionIsFresh, verifyUserPassword } from "@/server/auth/reauth";
import { canManagePerson } from "@/lib/permissions";

/** "+1 (416) 555-0100" → "+14165550100". Requires a country code. */
export function normalizePhone(v: string): string {
  return v.replace(/[\s().-]/g, "");
}
const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => /^\+[1-9]\d{6,14}$/.test(v), "Include the country code, e.g. +1 416 555 0100");

export const pinSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/, "Use 4 to 6 digits"),
    pinConfirm: z.string(),
  })
  .refine((v) => v.pin === v.pinConfirm, { path: ["pinConfirm"], message: "PINs don't match" });

function pastDate(v: string) {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d < new Date() && d.getUTCFullYear() >= 1900;
}

export const profileSchema = z
  .object({
    phone,
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth").refine(pastDate, "Enter a real date of birth"),
    address: z.string().trim().min(5, "Enter your address").max(300),
    emergencyContactName: z.string().trim().min(1, "Enter a name").max(120),
    emergencyContactRelation: z.string().trim().min(1, "Enter the relationship").max(60),
    emergencyContactPhone: phone,
    pin: z.string().regex(/^\d{4,6}$/, "Use 4 to 6 digits"),
    pinConfirm: z.string(),
  })
  .refine((v) => v.pin === v.pinConfirm, { path: ["pinConfirm"], message: "PINs don't match" });

export async function hashPin(membershipId: string, pin: string) {
  return pinDigest(env().PIN_HMAC_SECRET, membershipId, pin);
}

export async function completeProfile(ctx: BusinessContext, input: z.infer<typeof profileSchema>) {
  const data = {
    phone: input.phone,
    dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`),
    address: input.address,
    emergencyContactName: input.emergencyContactName,
    emergencyContactRelation: input.emergencyContactRelation,
    emergencyContactPhone: input.emergencyContactPhone,
    pinHmac: await hashPin(ctx.membership.id, input.pin),
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    completedAt: new Date(),
  };
  await ctx.db.employeeProfile.upsert({
    where: { membershipId: ctx.membership.id },
    create: { membershipId: ctx.membership.id, ...data } as never,
    update: data,
  });
}

/** First PIN after a manager reset — only allowed when no PIN is set. */
export async function setInitialPin(ctx: BusinessContext, input: z.infer<typeof pinSchema>) {
  const profile = await ctx.db.employeeProfile.findUnique({ where: { membershipId: ctx.membership.id } });
  if (profile?.pinHmac) throw new UserError("You already have a PIN. Change it from your account page.");
  await ctx.db.employeeProfile.update({
    where: { membershipId: ctx.membership.id },
    data: { pinHmac: await hashPin(ctx.membership.id, input.pin), pinFailedAttempts: 0, pinLockedUntil: null },
  });
}

export const changePinSchema = z
  .object({ currentPassword: z.string().max(200).optional(), pin: z.string().regex(/^\d{4,6}$/, "Use 4 to 6 digits"), pinConfirm: z.string() })
  .refine((v) => v.pin === v.pinConfirm, { path: ["pinConfirm"], message: "PINs don't match" });

/** §7.1: changing your PIN requires your password, or a fresh magic-link sign-in. */
export async function changePin(ctx: BusinessContext, input: z.infer<typeof changePinSchema>) {
  const ok = input.currentPassword
    ? await verifyUserPassword(ctx.userId, input.currentPassword)
    : await sessionIsFresh();
  if (!ok) {
    throw new UserError(
      input.currentPassword
        ? "That password isn't right."
        : "Confirm it's you: enter your password, or sign in again with an email link.",
      input.currentPassword ? { currentPassword: ["Incorrect password"] } : undefined,
    );
  }
  await ctx.db.employeeProfile.update({
    where: { membershipId: ctx.membership.id },
    data: { pinHmac: await hashPin(ctx.membership.id, input.pin), pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "PIN_CHANGED", targetType: "Membership", targetId: ctx.membership.id });
}

/** Managers reset (clear) a PIN; the employee sets a new one on next visit. */
export async function resetPin(ctx: BusinessContext, membershipId: string) {
  const target = await ctx.db.membership.findUnique({ where: { id: membershipId }, include: { role: true } });
  if (!target) throw new UserError("Person not found.");
  if (!canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "employees.edit")) {
    throw new UserError("You can only reset PINs for people junior to you.");
  }
  await ctx.db.employeeProfile.update({
    where: { membershipId },
    data: { pinHmac: null, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "PIN_RESET", targetType: "Membership", targetId: membershipId });
}
