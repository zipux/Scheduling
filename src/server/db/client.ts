import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The raw, unscoped Prisma client. Only these may import it:
 *   - src/server/db/tenant.ts (wraps it per business)
 *   - src/server/auth/** (users, sessions, memberships lookup)
 *   - src/server/platform/** (platform admin)
 *   - prisma/seed.ts and tests
 * Everything else must go through `tenantDb(businessId)`. An ESLint rule enforces this.
 */
// node-postgres currently treats sslmode=require as verify-full and warns about it;
// state that explicitly so behaviour is unchanged and the warning is silenced.
function connectionString() {
  const url = process.env.DATABASE_URL ?? "";
  return url.includes("sslmode=require") && !url.includes("uselibpqcompat")
    ? url.replace("sslmode=require", "sslmode=verify-full")
    : url;
}

function makeClient() {
  const adapter = new PrismaPg({ connectionString: connectionString() });
  // Remote Postgres (Neon) can be slow to hand out a connection after idling.
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 15_000, timeout: 30_000 } });
}

const g = globalThis as unknown as { __prisma?: ReturnType<typeof makeClient> };

export const rawDb = g.__prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") g.__prisma = rawDb;

export type RawDb = typeof rawDb;
