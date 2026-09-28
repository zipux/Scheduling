"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/app/use-action";

type Result = { ok: true; data: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** A button that runs a server action with fixed arguments, then refreshes the page. */
export function ActionButton<A>({
  action,
  businessId,
  args,
  label,
  success,
  variant = "outline",
  size = "sm",
  testId,
}: {
  action: (businessId: string, args: A) => Promise<Result>;
  businessId: string;
  args: A;
  label: string;
  success?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "sm" | "default";
  testId?: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      data-testid={testId}
      onClick={() => run<unknown>(() => action(businessId, args), () => router.refresh(), { success })}
    >
      {label}
    </Button>
  );
}
