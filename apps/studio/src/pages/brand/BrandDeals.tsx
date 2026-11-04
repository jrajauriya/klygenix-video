import { PageHeader } from "@klygenixvideo/ui"
import { useDeals } from "../../lib/market"
import { DealsTable } from "../../components/brand/DealsTable"
import { useT } from "../../i18n"

export default function BrandDeals() {
  const t = useT()
  const { data, isLoading } = useDeals()
  return (
    <div className="pb-8">
      <PageHeader title={t("Brand deals")} subtitle={t("Sponsorships you proposed. Fund them, then approve or dispute what the creator delivers.")} />
      <DealsTable rows={(data ?? []).filter((d) => d.role === "brand")} loading={isLoading} role="brand" />
    </div>
  )
}
