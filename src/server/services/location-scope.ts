import "server-only";
import { accessibleLocationIds, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { nextShiftLocation } from "./schedule";

export const ALL = "all";

/**
 * Location switcher (§5.2). One location by default — the one of the member's
 * next/current shift, otherwise their first assigned — with an "All locations"
 * option. The choice is remembered per member. No switcher with one location.
 */
export async function resolveLocationScope(ctx: BusinessContext, requested?: string | null) {
  const ids = await accessibleLocationIds(ctx);
  const locations = await ctx.db.location.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
  const options = locations.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone }));
  if (options.length <= 1) {
    return { options, selected: options[0]?.id ?? null, ids: options.map((o) => o.id), showSwitcher: false };
  }
  let selected: string | null = null;
  if (requested === ALL || (requested && ids.includes(requested))) selected = requested;
  else if (ctx.membership.preferAllLocations) selected = ALL;
  else if (ctx.membership.preferredLocationId && ids.includes(ctx.membership.preferredLocationId)) selected = ctx.membership.preferredLocationId;
  else {
    const next = await nextShiftLocation(ctx);
    if (next && ids.includes(next)) selected = next;
    else {
      const assigned = await ctx.db.membershipLocation.findFirst({
        where: { membershipId: ctx.membership.id, locationId: { in: ids } },
        include: { location: { select: { name: true } } },
        orderBy: { location: { name: "asc" } },
      });
      selected = assigned?.locationId ?? options[0].id;
    }
  }
  return { options, selected, ids: selected === ALL ? options.map((o) => o.id) : [selected!], showSwitcher: true };
}

export async function saveLocationPreference(ctx: BusinessContext, value: string) {
  if (value !== ALL && !(await accessibleLocationIds(ctx)).includes(value)) throw new UserError("Location not available.");
  await ctx.db.membership.update({
    where: { id: ctx.membership.id },
    data: value === ALL ? { preferAllLocations: true } : { preferAllLocations: false, preferredLocationId: value },
  });
}
