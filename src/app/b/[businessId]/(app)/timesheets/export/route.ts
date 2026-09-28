import { NextResponse } from "next/server";
import { requireBusinessAction, ForbiddenError, NotFoundError } from "@/server/auth/context";
import { payrollCsv, periodFor } from "@/server/services/timesheets";
import { rateLimit } from "@/server/rate-limit";

export async function GET(req: Request, { params }: RouteContext<"/b/[businessId]/timesheets/export">) {
  const { businessId } = await params;
  try {
    const ctx = await requireBusinessAction(businessId);
    if (!(await rateLimit(`export:${ctx.userId}`, 30, 3600))) return new NextResponse("Too many exports. Try again later.", { status: 429 });
    const period = periodFor(ctx, new URL(req.url).searchParams.get("period") ?? undefined);
    const csv = await payrollCsv(ctx, period);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-${period.start}-to-${period.end}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse(err.message, { status: 403 });
    if (err instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
}
