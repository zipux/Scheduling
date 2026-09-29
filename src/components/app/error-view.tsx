"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/** Body of every error boundary: what happened, a retry, and a way out. */
export function ErrorView({ error, retry, home = "/" }: { error: Error & { digest?: string }; retry: () => void; home?: string }) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center" data-testid="error-view">
      <AlertTriangle className="mb-3 size-8 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold">{t("error")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("errorBody")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">{t("errorRef", { digest: error.digest })}</p>}
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button size="lg" onClick={() => retry()}>
          <RotateCw aria-hidden />
          {t("tryAgain")}
        </Button>
        <Link href={home} className={buttonVariants({ variant: "outline", size: "lg" })}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
