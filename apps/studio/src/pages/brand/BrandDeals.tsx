import { PageHeader } from "@klygenixvideo/ui"
import { useDeals } from "../../lib/market"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../../components/team/ViewOnly"
import { DealsTable } from "../../components/brand/DealsTable"
import { useT } from "../../i18n"

export default function BrandDeals() {
  const t = useT()
  const { data, isLoading } = useDeals()
  const canEdit = useHasPermission("video.brand", "full")
  return (
    <div className="pb-8">
      <PageHeader title={t("Brand deals")} subtitle={t("Sponsorships you proposed. Fund them, then approve or dispute what the creator delivers.")} />
      {!canEdit && <ViewOnly className="mb-4" what={t("Your role can follow deals but not fund, approve or dispute them.")} />}
      <DealsTable rows={(data ?? []).filter((d) => d.role === "brand")} loading={isLoading} role="brand" />
    </div>
  )
}
