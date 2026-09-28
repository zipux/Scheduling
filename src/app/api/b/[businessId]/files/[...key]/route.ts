import { requireBusinessAction } from "@/server/auth/context";
import { readAttachment } from "@/server/services/messaging";

/** Serves a message attachment only to members of a conversation that contains it. */
export async function GET(_req: Request, { params }: RouteContext<"/api/b/[businessId]/files/[...key]">) {
  const { businessId, key } = await params;
  try {
    const ctx = await requireBusinessAction(businessId);
    const file = await readAttachment(ctx, key.join("/"));
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file.bytes as BodyInit, {
      headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
