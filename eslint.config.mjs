import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Multi-tenant rule (Spec §3.3): only the modules below may touch the raw,
  // unscoped Prisma client. Everything else goes through tenantDb(businessId).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/db/**",
      "src/server/auth/**",
      "src/server/platform/**",
      "src/server/email/**",
      "src/server/audit.ts",
      "src/server/rate-limit.ts",
      "src/app/dev/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/db/client",
              message: "Use tenantDb(businessId) via the business context instead of the raw Prisma client.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
