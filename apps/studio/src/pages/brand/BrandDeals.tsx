import { PageHeader } from "@klygenixvideo/ui"
import { useDeals } from "../../lib/market"
import { DealsTable } from "../../components/brand/DealsTable"

export default function BrandDeals() {
  const { data, isLoading } = useDeals()
  return (
    <div className="pb-8">
      <PageHeader title="Brand deals" subtitle="Sponsorships you proposed. Fund them, then approve or dispute what the creator delivers." />
      <DealsTable rows={(data ?? []).filter((d) => d.role === "brand")} loading={isLoading} role="brand" />
    </div>
  )
}
