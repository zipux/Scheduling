"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { getSession } from "@/server/auth/context";
import { acceptInvitation, createAccountFromInvitation } from "@/server/platform/accept-invitation";
import { toResult, type ActionResult } from "@/server/action";
import { rateLimit } from "@/server/rate-limit";

const tokenSchema = z.string().min(20).max(200);

export async function acceptAsCurrentUser(token: string): Promise<ActionResult<{ businessId: string }>> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Sign in first." };
    const businessId = await acceptInvitation(tokenSchema.parse(token), session.user.id);
    return { ok: true, data: { businessId } };
  } catch (err) {
    return toResult(err);
  }
}

const createSchema = z
  .object({
    token: tokenSchema,
    name: z.string().trim().min(1, "Enter your name").max(120),
    method: z.enum(["password", "magic_link"]),
    password: z.string().max(200).optional(),
    confirm: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "password") return;
    if (!v.password || v.password.length < 10) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "Use at least 10 characters" });
    } else if (v.password !== v.confirm) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Passwords don't match" });
    }
  });

export async function createAccountAndAccept(
  raw: z.input<typeof createSchema>,
): Promise<ActionResult<{ businessId: string; next: "signed_in" | "check_email" }>> {
  try {
    const input = createSchema.parse(raw);
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!(await rateLimit(`invite-accept:${ip}`, 20, 600))) {
      return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
    }
    const res = await createAccountFromInvitation(input.token, {
      name: input.name,
      password: input.method === "password" ? input.password! : null,
    });
    if (input.method === "password") {
      await auth.api.signInEmail({ body: { email: res.email, password: input.password! }, headers: h });
      return { ok: true, data: { businessId: res.businessId, next: "signed_in" } };
    }
    await auth.api.signInMagicLink({ body: { email: res.email, callbackURL: `/b/${res.businessId}` }, headers: h });
    return { ok: true, data: { businessId: res.businessId, next: "check_email" } };
  } catch (err) {
    return toResult(err);
  }
}
