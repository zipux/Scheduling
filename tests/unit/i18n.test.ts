import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr-CA.json";
import ja from "../../messages/ja.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n catalogues", () => {
  const enKeys = new Set(keys(en));
  it.each([
    ["fr-CA", fr],
    ["ja", ja],
  ])("%s only contains keys that exist in English", (_, cat) => {
    expect(keys(cat as Record<string, unknown>).filter((k) => !enKeys.has(k))).toEqual([]);
  });
});
