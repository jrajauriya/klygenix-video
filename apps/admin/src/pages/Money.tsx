import { useSearchParams } from "react-router-dom"
import { PageHeader, Tabs } from "@klygenixvideo/ui"
import { Overview } from "../components/money/Overview"
import { Creators } from "../components/money/Creators"
import { Transfers } from "../components/money/Transfers"
import { Payments, Refunds } from "../components/money/Payments"

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "creators", label: "Creators" },
  { key: "transfers", label: "Transfers" },
  { key: "payments", label: "Payments" },
  { key: "refunds", label: "Refunds" },
]

export default function Money() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "overview"
  const status = params.get("status") ?? ""
  const tenant = params.get("tenant") ?? ""
  const purpose = params.get("purpose") ?? ""

  function go(next: Record<string, string>) {
    const merged: Record<string, string> = { tab, status, tenant, purpose, ...next }
    setParams(Object.fromEntries(Object.entries(merged).filter(([k, v]) => v && !(k === "tab" && v === "overview"))), { replace: true })
  }

  return (
    <>
      <PageHeader title="Creator money" subtitle="Creator sales, payouts to creators, refunds and month-end tax reports" />
      <Tabs tabs={TABS} active={tab} onChange={(k) => go({ tab: k, status: "", tenant: "", purpose: "" })} />
      <div className="pb-8">
        {tab === "overview" && <Overview />}
        {tab === "creators" && <Creators onTransfers={(id) => go({ tab: "transfers", tenant: String(id), status: "" })} />}
        {tab === "transfers" && (
          <Transfers status={status} tenantId={tenant} onFilter={(f) => go({ ...(f.status !== undefined ? { status: f.status } : {}), ...(f.tenant !== undefined ? { tenant: f.tenant } : {}) })} />
        )}
        {tab === "payments" && <Payments purpose={purpose} onPurpose={(v) => go({ purpose: v })} />}
        {tab === "refunds" && <Refunds />}
      </div>
    </>
  )
}
