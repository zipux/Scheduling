"use client";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";

export function BusinessSwitcher({
  current,
  options,
  label,
}: {
  current: string;
  options: { id: string; name: string }[];
  label: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <Building2 className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}</span>
      <select
        className="h-11 max-w-[10rem] rounded-md border bg-background px-2 md:h-9"
        value={current}
        onChange={(e) => router.push(`/b/${e.target.value}`)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
