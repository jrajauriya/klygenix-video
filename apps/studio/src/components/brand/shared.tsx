import { Link } from "react-router-dom"
import { Building2 } from "lucide-react"
import { Card, StatusPill, buttonVariants } from "@klygenixvideo/ui"
import { APPLICATION_STATUS, CAMPAIGN_STATUS, DEAL_STATUS, type CampaignStatus, type DealStatus } from "../../lib/market"

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  const s = CAMPAIGN_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

export function DealStatusPill({ status }: { status: DealStatus }) {
  const s = DEAL_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

export function ApplicationStatusPill({ status }: { status: string }) {
  const s = APPLICATION_STATUS[status] ?? { label: status, hex: "#475569" }
  return <StatusPill label={s.label} hex={s.hex} />
}

export function NeedsBrand({ what }: { what: string }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
        <Building2 size={20} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-navy">Set up your brand profile first</p>
        <p className="text-sm text-slate-600">{what} run under your brand name, so creators and viewers know who is behind them.</p>
      </div>
      <Link to="/brand" className={buttonVariants({ size: "sm" })}>Set up the brand profile</Link>
    </Card>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3.5 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-num text-lg font-bold text-navy">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
