import "server-only";
import { rawDb } from "@/server/db/client";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { buildIcs } from "@/lib/ics";

/** Creates (or rotates) the user's secret feed token and returns the subscribe URL. */
export async function rotateCalendarFeed(userId: string) {
  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  await rawDb.calendarFeed.upsert({ where: { userId }, create: { userId, tokenHash }, update: { tokenHash, createdAt: new Date() } });
  return `${env().APP_URL}/api/calendar/${token}.ics`;
}

export async function hasCalendarFeed(userId: string) {
  return !!(await rawDb.calendarFeed.findUnique({ where: { userId } }));
}

/**
 * The user's own published shifts, across every business where they currently
 * have access, from 30 days ago onwards. Nothing about colleagues is included.
 */
export async function calendarForToken(token: string): Promise<string | null> {
  const clean = token.replace(/\.ics$/, "");
  if (clean.length < 20 || clean.length > 100) return null;
  const feed = await rawDb.calendarFeed.findUnique({ where: { tokenHash: await sha256Hex(clean) } });
  if (!feed) return null;
  const memberships = await rawDb.membership.findMany({
    where: { userId: feed.userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
    select: { id: true, business: { select: { name: true } } },
  });
  const shifts = await rawDb.shift.findMany({
    where: {
      membershipId: { in: memberships.map((m) => m.id) },
      status: "published",
      deletedAt: null,
      endsAt: { gte: new Date(Date.now() - 30 * 86400_000) },
    },
    include: { location: { select: { name: true, address: true } }, position: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: 1000,
  });
  const bizOf = new Map(memberships.map((m) => [m.id, m.business.name]));
  return buildIcs(
    "My shifts",
    shifts.map((s) => ({
      uid: `${s.id}@shiftwise`,
      start: s.startsAt,
      end: s.endsAt,
      updated: s.updatedAt,
      summary: `${s.position?.name ? `${s.position.name} shift` : "Shift"} — ${bizOf.get(s.membershipId!) ?? ""}`,
      location: [s.location.name, s.location.address].filter(Boolean).join(", "),
      description: s.notes ?? undefined,
    })),
  );
}
