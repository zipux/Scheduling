"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldError } from "@/components/app/field-error";
import { acceptAsCurrentUser, createAccountAndAccept } from "./actions";

export function AcceptExisting({ token }: { token: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptAsCurrentUser(token);
            if (!res.ok) return setError(res.error);
            router.replace(`/b/${res.data.businessId}`);
            router.refresh();
          })
        }
      >
        {t("accept")}
      </Button>
    </div>
  );
}

export function CreateAccountForm({ token, defaultName, email }: { token: string; defaultName: string; email: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [checkEmail, setCheckEmail] = useState(false);

  function submit(method: "password" | "magic_link") {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const res = await createAccountAndAccept({ token, name, method, password, confirm });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      if (res.data.next === "check_email") return setCheckEmail(true);
      router.replace(`/b/${res.data.businessId}`);
      router.refresh();
    });
  }

  if (checkEmail) {
    return (
      <Alert role="status">
        <AlertDescription>{t("checkEmail", { email })}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit("password");
      }}
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="name">{t("yourName")}</Label>
        <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <FieldError errors={fieldErrors.name} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("choosePassword")}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {t("passwordHint")}
        </p>
        <FieldError errors={fieldErrors.password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("confirmPassword")}</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <FieldError errors={fieldErrors.confirm} />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t("createAccount")}
      </Button>
      <Button type="button" variant="outline" size="lg" className="w-full" disabled={pending} onClick={() => submit("magic_link")}>
        {t("useMagicLink")}
      </Button>
    </form>
  );
}
