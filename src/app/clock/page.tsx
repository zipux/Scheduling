import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/context";
import { soonestShiftBusiness } from "@/server/auth/memberships";

/** Default the clock to the business whose shift starts soonest; the clock page offers a switcher. */
export default async function ClockRedirect() {
  const user = await requireUser();
  const businessId = await soonestShiftBusiness(user.id);
  redirect(businessId ? `/b/${businessId}/clock` : "/");
}
