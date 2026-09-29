"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { clearOfflinePages } from "@/components/app/service-worker";
import { Button } from "@/components/ui/button";

export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const router = useRouter();
  return (
    <Button
      variant="outline"
      className={className}
      onClick={async () => {
        await clearOfflinePages();
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      <LogOut aria-hidden />
      {t("signOut")}
    </Button>
  );
}
