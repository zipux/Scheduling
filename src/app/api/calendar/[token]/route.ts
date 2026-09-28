import { calendarForToken } from "@/server/platform/calendar";

export async function GET(_req: Request, { params }: RouteContext<"/api/calendar/[token]">) {
  const { token } = await params;
  const ics = await calendarForToken(token);
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="shifts.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
