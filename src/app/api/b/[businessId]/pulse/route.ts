import { NextResponse } from "next/server";
import { requireBusinessAction } from "@/server/auth/context";
import { unreadCounts } from "@/server/services/messaging";
import { unreadNotificationCount } from "@/server/services/notifications";

/** Polled every few seconds by the app shell for badges (§2: polling, no extra infrastructure). */
export async function GET(_req: Request, { params }: RouteContext<"/api/b/[businessId]/pulse">) {
  const { businessId } = await params;
  try {
    const ctx = await requireBusinessAction(businessId);
    const [counts, notifications] = await Promise.all([unreadCounts(ctx), unreadNotificationCount(ctx)]);
    return NextResponse.json({ ...counts, notifications }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
