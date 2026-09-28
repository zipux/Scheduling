import { NextResponse } from "next/server";
import { flushAllDueNotifications } from "@/server/platform/notifications";

// External cron trigger (optional — the app also flushes in-process every minute).
// Requires `Authorization: Bearer $CRON_SECRET`.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await flushAllDueNotifications());
}
