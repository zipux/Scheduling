import { execSync } from "node:child_process";

export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "1") return;
  execSync("npm run db:test:seed", { stdio: "inherit" });
}
