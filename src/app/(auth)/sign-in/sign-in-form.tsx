"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function SignInForm({ next, defaultEmail }: { next: string; defaultEmail: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"password" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending("password");
    const res = await authClient.signIn.email({ email, password });
    setPending(null);
    if (res.error) {
      setError(res.error.status === 429 ? t("rateLimited") : t("invalidCredentials"));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function onMagicLink() {
    setError(null);
    setInfo(null);
    if (!email) return;
    setPending("link");
    const res = await authClient.signIn.magicLink({ email, callbackURL: next });
    setPending(null);
    if (res.error?.status === 429) {
      setError(t("rateLimited"));
      return;
    }
    // Same message whether or not the account exists (no account enumeration).
    setInfo(t("linkSent"));
  }

  return (
    <form onSubmit={onPassword} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert role="status">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" size="lg" disabled={pending !== null || !email || !password}>
        {pending === "password" ? t("signingIn") : t("signIn")}
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        size="lg"
        onClick={onMagicLink}
        disabled={pending !== null || !email}
      >
        {t("emailMeALink")}
      </Button>
    </form>
  );
}
