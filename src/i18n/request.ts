import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";
import en from "../../messages/en.json";

type Messages = Record<string, unknown>;

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] =
      v && typeof v === "object" && b && typeof b === "object"
        ? deepMerge(b as Messages, v as Messages)
        : v;
  }
  return out;
}

// No locale segment in URLs: the locale comes from a cookie (set from the user's
// preference). English is complete; other locales fall back to English per key.
export default getRequestConfig(async () => {
  const store = await cookies();
  const requested = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  const messages =
    locale === "en" ? en : deepMerge(en, (await import(`../../messages/${locale}.json`)).default as Messages);
  return {
    locale,
    messages,
    timeZone: "UTC",
    // In tests (I18N_STRICT=1) a missing or malformed message fails loudly instead of rendering the key.
    onError(error) {
      if (process.env.I18N_STRICT === "1") throw error;
      console.error(error);
    },
  };
});
