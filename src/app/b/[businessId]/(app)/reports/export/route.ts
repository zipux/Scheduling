import { NextResponse } from "next/server";
import { requireBusinessAction, ForbiddenError, NotFoundError } from "@/server/auth/context";
import { REPORTS, reportCsv, type ReportKey } from "@/server/services/reports";
import { periodFor } from "@/server/services/timesheets";
import { rateLimit } from "@/server/rate-limit";

export async function GET(req: Request, { params }: RouteContext<"/b/[businessId]/reports/export">) {
  const { businessId } = await params;
  try {
    const ctx = await requireBusinessAction(businessId);
    if (!(await rateLimit(`export:${ctx.userId}`, 30, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });
    const sp = new URL(req.url).searchParams;
    const key = (REPORTS as readonly string[]).includes(sp.get("type") ?? "") ? (sp.get("type") as ReportKey) : "hours";
    const period = periodFor(ctx, sp.get("period") ?? undefined);
    return new NextResponse(await reportCsv(ctx, key, period), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${key}-${period.start}-to-${period.end}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse(err.message, { status: 403 });
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
