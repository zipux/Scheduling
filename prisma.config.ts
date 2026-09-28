import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use MIGRATE_DATABASE_URL when set (e.g. a non-pooled URL),
// otherwise DATABASE_URL. See DECISIONS.md.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
