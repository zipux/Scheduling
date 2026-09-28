import "server-only";
import { verifyPassword } from "better-auth/crypto";
import { rawDb } from "@/server/db/client";
import { getSession } from "./context";

export const FRESH_SESSION_MINUTES = 10;

/** True if the password matches the user's credential account. */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const account = await rawDb.account.findFirst({ where: { userId, providerId: "credential" } });
  if (!account?.password) return false;
  return verifyPassword({ hash: account.password, password });
}

export async function userHasPassword(userId: string): Promise<boolean> {
  const account = await rawDb.account.findFirst({ where: { userId, providerId: "credential" }, select: { password: true } });
  return !!account?.password;
}

/** A session created within the last few minutes counts as a magic-link re-authentication. */
export async function sessionIsFresh(): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  return Date.now() - new Date(s.session.createdAt).getTime() < FRESH_SESSION_MINUTES * 60_000;
}

/** Ends every session of a user (used when access is revoked, §11). */
export async function revokeAllSessions(userId: string) {
  await rawDb.session.deleteMany({ where: { userId } });
}
