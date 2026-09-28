import type { TimesheetResult } from "./calculate";

/**
 * Approval gate (§7.6.7). Approval is blocked while any entry in the period
 * carries an unresolved BLOCKING flag. An Owner may approve with exceptions;
 * each unresolved flag is then returned to be written individually to the audit
 * log. A calculation the app refused to make (`blocked`) can never be approved.
 */
export type GateResult =
  | { allowed: true; exceptions: TimesheetResult["unresolvedFlags"] }
  | { allowed: false; reason: "CALCULATION_BLOCKED" | "BLOCKING_FLAGS"; count: number };

export function approvalGate(
  r: Pick<TimesheetResult, "unresolvedFlags" | "blocked">,
  opts: { isOwner: boolean; withExceptions: boolean },
): GateResult {
  if (r.blocked.length) return { allowed: false, reason: "CALCULATION_BLOCKED", count: r.blocked.length };
  const blocking = r.unresolvedFlags.filter((f) => f.blocking);
  if (!blocking.length) return { allowed: true, exceptions: [] };
  if (opts.isOwner && opts.withExceptions) return { allowed: true, exceptions: blocking };
  return { allowed: false, reason: "BLOCKING_FLAGS", count: blocking.length };
}
