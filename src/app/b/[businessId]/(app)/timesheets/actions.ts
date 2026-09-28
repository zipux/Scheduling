"use server";

import { businessAction } from "@/server/action";
import { adjustVacation, approveSchema, approveTimesheet, overrideEntitlement, overrideEntitlementSchema, reopenSchema, reopenTimesheet, vacationAdjustSchema } from "@/server/services/timesheets";

export const approveTimesheetAction = businessAction(approveSchema, approveTimesheet);
export const reopenTimesheetAction = businessAction(reopenSchema, reopenTimesheet);
export const adjustVacationAction = businessAction(vacationAdjustSchema, adjustVacation);
export const overrideEntitlementAction = businessAction(overrideEntitlementSchema, overrideEntitlement);
