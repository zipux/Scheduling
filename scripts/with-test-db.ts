// Runs a command with DATABASE_URL pointed at TEST_DATABASE_URL.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set");
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must differ from DATABASE_URL");
  process.exit(1);
}
const [cmd, ...args] = process.argv.slice(2);
const res = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  // Neon's pooler can strand Prisma's session advisory lock; nothing else migrates the test DB concurrently.
  env: { ...process.env, DATABASE_URL: url, MIGRATE_DATABASE_URL: process.env.TEST_MIGRATE_DATABASE_URL ?? url, PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1" },
});
process.exit(res.status ?? 1);
