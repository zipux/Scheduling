"use server";

import { businessAction } from "@/server/action";
import { completeProfile, pinSchema, profileSchema, setInitialPin } from "@/server/services/profile";
import { completeSetup, setupSchema } from "@/server/services/setup";

export const completeProfileAction = businessAction(profileSchema, completeProfile);
export const setInitialPinAction = businessAction(pinSchema, setInitialPin);
export const completeSetupAction = businessAction(setupSchema, completeSetup);
