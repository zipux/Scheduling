"use server";

import { businessAction } from "@/server/action";
import { changePin, changePinSchema } from "@/server/services/profile";

export const changePinAction = businessAction(changePinSchema, changePin);
