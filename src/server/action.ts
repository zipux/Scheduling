import "server-only";
import { z } from "zod";
import { ForbiddenError, NotFoundError, requireBusinessAction, type BusinessContext } from "@/server/auth/context";
import { TenantViolationError } from "@/server/db/tenant";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** A user-facing failure (validation, conflict, business rule). Its message is shown as-is. */
export class UserError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export function toResult(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  if (err instanceof UserError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "Not found." };
  if (err instanceof TenantViolationError) {
    console.error(err);
    return { ok: false, error: "Not found." };
  }
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Wraps a business-scoped server action: validates input with Zod, resolves the
 * caller's business context (membership, permissions, tenant DB) and maps errors
 * to an ActionResult. Every permission check still happens inside `fn`.
 */
export function businessAction<S extends z.ZodType, T>(
  schema: S,
  fn: (ctx: BusinessContext, input: z.infer<S>) => Promise<T>,
) {
  return async (businessId: string, raw: z.input<S>): Promise<ActionResult<T>> => {
    try {
      const ctx = await requireBusinessAction(businessId);
      const input = schema.parse(raw);
      return { ok: true, data: await fn(ctx, input) };
    } catch (err) {
      return toResult(err);
    }
  };
}
