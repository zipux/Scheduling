import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { rawDb } from "@/server/db/client";
import { env } from "@/lib/env";
import { sendEmail } from "@/server/email/send";
import { magicLinkEmail } from "@/server/email/templates";

const e = env();

export const auth = betterAuth({
  appName: "Shiftwise",
  baseURL: e.APP_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: prismaAdapter(rawDb, { provider: "postgresql" }),
  // Accounts are only ever created from an invitation (Spec §4) — never by public sign-up.
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      isPlatformAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      locale: { type: "string", required: false, defaultValue: "en", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    useSecureCookies: e.APP_URL.startsWith("https://"),
    database: { generateId: false },
  },
  // Spec §11: rate-limit login and magic link. In-memory store (single node); see DECISIONS.md.
  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT !== "1",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/magic-link": { window: 60, max: 5 },
    },
  },
  plugins: [
    magicLink({
      disableSignUp: true,
      expiresIn: 60 * 15,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        const tpl = await magicLinkEmail({ url });
        await sendEmail({ to: email, template: "magic-link", ...tpl });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
