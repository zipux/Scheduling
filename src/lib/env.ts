import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

// Dev-only fallbacks so `npm run dev` works from a minimal .env. Production
// refuses to start without real secrets (see DECISIONS.md).
function devSecret(name: string): string {
  if (isProd) throw new Error(`${name} must be set in production`);
  return `dev-only-insecure-${name.toLowerCase()}-change-me-0123456789`;
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  PIN_HMAC_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default("Shiftwise <no-reply@localhost>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  cached = schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL ?? process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? devSecret("BETTER_AUTH_SECRET"),
    PIN_HMAC_SECRET: process.env.PIN_HMAC_SECRET ?? devSecret("PIN_HMAC_SECRET"),
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
  });
  return cached;
}

export const isDev = !isProd;
