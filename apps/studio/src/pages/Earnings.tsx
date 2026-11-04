import { useSearchParams } from "react-router-dom"
import { EmptyState, PageHeader, Spinner, Tabs } from "@klygenixvideo/ui"
import { useEarnings, PayoutsOff, AccountStatusPill } from "../components/earnings/shared"
import { Overview } from "../components/earnings/Overview"
import { PayoutSetup } from "../components/earnings/PayoutSetup"
import { Memberships } from "../components/earnings/Memberships"
import { Activity } from "../components/earnings/Activity"
import { Statements } from "../components/earnings/Statements"
import { Ads } from "../components/earnings/Ads"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "payouts", label: "Payouts" },
  { key: "memberships", label: "Memberships" },
  { key: "activity", label: "Sales & transfers" },
  { key: "ads", label: "Ads" },
  { key: "statements", label: "Statements" },
]

export default function Earnings() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "overview"
  const { data, isLoading, isError } = useEarnings()

  if (isLoading) return <Spinner />
  if (isError || !data) return <EmptyState title="Earnings could not be loaded" hint="Try again in a moment." />

  const off = !data.can_take_money
  const suspended = data.problem === "channel_cannot_take_money"

  return (
    <div className="pb-8">
      <PageHeader
        title="Earnings"
        subtitle="What viewers paid you, what is on its way to your bank, and your payout setup."
        actions={<span className="flex items-center gap-2 text-sm text-slate-500">Payouts <AccountStatusPill status={data.account?.status} /></span>}
      />
      {off && (
        <PayoutsOff action={tab !== "payouts" && !suspended}>
          {suspended
            ? "Your channel cannot take money while it is suspended. Tips, memberships and paid videos are off."
            : data.account?.status === "needs_clarification"
              ? "The payment partner needs a few changes to your payout details. Tips, memberships and paid videos stay off until payouts are active."
              : undefined}
        </PayoutsOff>
      )}
      <Tabs tabs={TABS} active={tab} onChange={(k) => setParams(k === "overview" ? {} : { tab: k }, { replace: true })} />
      <div>
        {tab === "overview" && <Overview data={data} />}
        {tab === "payouts" && <PayoutSetup key={data.account?.status ?? "none"} data={data} />}
        {tab === "memberships" && <Memberships canSell={data.can_take_money} />}
        {tab === "activity" && <Activity />}
        {tab === "ads" && <Ads canTakeMoney={data.can_take_money} />}
        {tab === "statements" && <Statements month={data.month} />}
      </div>
    </div>
  )
}
