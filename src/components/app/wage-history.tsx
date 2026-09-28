import { getTranslations } from "next-intl/server";
import { formatCents } from "@/lib/money";

export async function WageHistory({
  wages,
  currency,
  positions,
}: {
  wages: { id: string; rateCents: number; type: string; positionId: string | null; effectiveFrom: Date; createdAt: Date }[];
  currency: string;
  positions: Map<string, string>;
}) {
  const t = await getTranslations("wages");
  if (!wages.length) return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul className="divide-y rounded-lg border" data-testid="wage-history">
      {wages.map((w) => {
        const from = w.effectiveFrom.toISOString().slice(0, 10);
        return (
          <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
            <span className="font-medium tabular-nums">
              {formatCents(w.rateCents, currency)}
              <span className="text-sm font-normal text-muted-foreground"> {w.type === "salary" ? t("perYear") : t("perHour")}</span>
            </span>
            <span className="text-sm text-muted-foreground">{w.positionId ? positions.get(w.positionId) ?? "—" : t("allPositions")}</span>
            <span className="ml-auto text-sm text-muted-foreground">
              {from > today ? t("startsOn", { date: from }) : t("from", { date: from })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
