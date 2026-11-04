import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Card, DataTable, Spinner, StatusPill, ToggleField } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { compact, detail } from "../../lib/format"
import { bps } from "../../lib/market"
import { inr } from "./shared"

interface AdsSettings {
  ads_enabled: boolean
  share_bps: number
  rules: string[]
}

interface AdsMonth {
  period: string
  impressions: number
  ad_spend_minor: number
  share_minor: number
  status: "accruing" | "pending" | "released" | "failed" | "skipped"
  note: string | null
}

const PAYOUT_STATUS: Record<string, { label: string; hex: string }> = {
  accruing: { label: "Building up", hex: "#1d4ed8" },
  pending: { label: "On the way", hex: "#92400e" },
  released: { label: "Paid", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
  skipped: { label: "Skipped", hex: "#475569" },
}

const monthName = (period: string) => {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
}

export function Ads({ canTakeMoney }: { canTakeMoney: boolean }) {
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.earnings", "full")
  const { data: settings, isLoading } = useQuery({
    queryKey: ["studio-ads-settings"],
    queryFn: async () => (await api.get<AdsSettings>(`${STUDIO}/ads/settings`)).data,
  })
  const { data: revenue, isLoading: revenueLoading } = useQuery({
    queryKey: ["studio-ads-revenue"],
    queryFn: async () => (await api.get<{ share_bps: number; months: AdsMonth[] }>(`${STUDIO}/ads/revenue`)).data,
  })

  async function toggle(on: boolean) {
    try {
      const { data } = await api.put<{ ads_enabled: boolean }>(`${STUDIO}/ads/settings`, { ads_enabled: on })
      qc.setQueryData<AdsSettings>(["studio-ads-settings"], (old) => (old ? { ...old, ads_enabled: data.ads_enabled } : old))
      toast.success(data.ads_enabled ? "Ads are on for your channel" : "Ads are off for your channel")
    } catch (err) {
      toast.error(detail(err, "Could not change the ads setting"))
    }
  }

  if (isLoading || !settings) return <Spinner />

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-sm font-bold text-navy">Ads on your videos</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Brands pay to show short ads before and during long videos. You get {bps(settings.share_bps)} of what they spend on your videos, paid monthly.
          </p>
          <div className="mt-3 border-t border-slate-100 pt-2">
            <ToggleField
              label="Show ads on my channel"
              hint={settings.ads_enabled
                ? "On. Every eligible video shows ads unless you turn them off for that video."
                : "Off. Turn it on and every eligible video shows ads; you can switch single videos off in their Monetisation tab."}
              checked={settings.ads_enabled}
              onChange={toggle}
              disabled={!canEdit}
            />
          </div>
          {!canTakeMoney && (
            <p className="mt-2 text-xs text-amber-900">Your share is only paid out once your payouts are active. It builds up until then.</p>
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-navy">The rules</h2>
          <ul className="mt-2 space-y-1.5">
            {settings.rules.map((r) => (
              <li key={r} className="flex gap-2 text-sm text-slate-600">
                <Check size={15} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" /> {r}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <DataTable
        label="Ad revenue by month"
        loading={revenueLoading}
        rows={revenue?.months ?? []}
        rowKey={(r) => r.period}
        unitLabel="months"
        emptyTitle="No ad revenue yet"
        emptyDescription={settings.ads_enabled ? "Ads show on eligible videos as brands run campaigns." : "Turn ads on to start earning from them."}
        columns={[
          { key: "period", header: "Month", render: (r) => monthName(r.period) },
          { key: "impressions", header: "Ads shown", align: "right", render: (r) => <span className="font-num">{compact(r.impressions)}</span> },
          { key: "spend", header: "Brands spent", align: "right", render: (r) => <span className="font-num">{inr(r.ad_spend_minor)}</span> },
          { key: "share", header: "Your share", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.share_minor)}</span> },
          {
            key: "status",
            header: "Payout",
            render: (r) => {
              const s = PAYOUT_STATUS[r.status] ?? { label: r.status, hex: "#475569" }
              return (
                <span className="inline-flex flex-col gap-0.5">
                  <StatusPill label={s.label} hex={s.hex} />
                  {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
                </span>
              )
            },
          },
        ]}
      />
    </div>
  )
}
