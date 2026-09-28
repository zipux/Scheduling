import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_MODELS, RELATION_FIELDS, TENANT_MODELS } from "@/server/db/tenant";

// Keeps the tenant DAL's model lists in sync with prisma/schema.prisma, so a new
// table with a businessId column can't silently escape isolation.
const schema = readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => {
  const fields = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@") && !l.startsWith("///"))
    .map((l) => l.split(/\s+/));
  return { name, fields };
});
const modelNames = new Set(models.map((m) => m.name));

describe("tenant DAL ↔ schema", () => {
  it("registers every model that has a businessId column as tenant-scoped", () => {
    const withBusinessId = models.filter((m) => m.fields.some((f) => f[0] === "businessId")).map((m) => m.name);
    expect([...TENANT_MODELS].sort()).toEqual(withBusinessId.sort());
  });

  it("every model is either tenant-scoped, Business, User, or explicitly forbidden", () => {
    const known = new Set<string>([...TENANT_MODELS, ...FORBIDDEN_MODELS, "Business", "User"]);
    expect(models.map((m) => m.name).filter((n) => !known.has(n))).toEqual([]);
  });

  it("lists every relation field, so nested writes are refused", () => {
    for (const m of models) {
      const relations = m.fields
        .filter((f) => modelNames.has(f[1]?.replace(/[?[\]]/g, "")))
        .map((f) => f[0])
        .sort();
      expect([...(RELATION_FIELDS[m.name] ?? [])].sort(), m.name).toEqual(relations);
    }
  });
});
