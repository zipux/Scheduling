import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, body, children }: { icon?: LucideIcon; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-10 text-center">
      {Icon && <Icon className="mb-3 size-8 text-muted-foreground" aria-hidden />}
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
