import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

/** Loading state for a page: a title bar and a few rows, announced once to screen readers. */
export async function PageSkeleton({ rows = 5, variant = "list" }: { rows?: number; variant?: "list" | "grid" }) {
  const t = await getTranslations("common");
  return (
    <div role="status" aria-live="polite" data-testid="page-loading">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72 max-w-full" />
      {variant === "grid" ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          {Array.from({ length: 14 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
    </div>
  );
}
