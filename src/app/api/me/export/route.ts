import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/context";
import { rateLimit } from "@/server/rate-limit";
import { auditUserExport, buildUserExport } from "@/server/platform/data-export";

/** "Export my data" (Spec §10.1): a JSON download of the signed-in user's own data. */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in first.", { status: 401 });
  const userId = session.user.id;
  if (!(await rateLimit(`data-export:${userId}`, 5, 3600))) return new NextResponse("Too many exports. Try again in an hour.", { status: 429 });
  const payload = await buildUserExport(userId);
  await auditUserExport(userId, payload.businesses);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${payload.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
