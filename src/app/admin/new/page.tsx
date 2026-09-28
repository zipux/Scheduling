import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { COUNTRIES, CURRENCIES, REGIONS, timezones } from "@/lib/regions";
import { NewBusinessForm } from "./new-business-form";

export default async function NewBusinessPage() {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("createBusiness")} description={t("createBusinessHint")} />
      <NewBusinessForm
        countries={[...COUNTRIES]}
        regions={REGIONS}
        timezones={timezones()}
        currencies={[...CURRENCIES]}
      />
    </>
  );
}
