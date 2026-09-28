"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Runs a server action, tracking pending state and field errors, toasting failures. */
export function useAction() {
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  function run<T>(fn: () => Promise<Result<T>>, onSuccess?: (data: T) => void, opts: { success?: string } = {}) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setFieldErrors({});
      if (opts.success) toast.success(opts.success);
      onSuccess?.(res.data);
    });
  }
  return { pending, fieldErrors, error, run, setFieldErrors };
}
