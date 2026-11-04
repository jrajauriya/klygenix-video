import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Card, DataTable, Spinner, StatusPill, ToggleField } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { compact, detail, watchTime } from "../../lib/format"
import { bps } from "../../lib/market"
import { inr } from "./shared"
import { useLang, useT } from "../../i18n"

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

interface PoolMonth {
  period: string
  watch_ms: number
  share_minor: number
  status: string
  note: string | null
}

const PAYOUT_STATUS: Record<string, { label: string; hex: string }> = {
  accruing: { label: "Building up", hex: "#1d4ed8" },
  pending: { label: "On the way", hex: "#92400e" },
  released: { label: "Paid", hex: "#166534" },
  failed: { label: "Failed", hex: "#b91c1c" },
  skipped: { label: "Skipped", hex: "#475569" },
  held: { label: "Held", hex: "#92400e" },
}

const monthName = (period: string, lang: string) => {
  const [y, m] = period.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
}

export function Ads({ canTakeMoney }: { canTakeMoney: boolean }) {
  const t = useT()
  const lang = useLang()
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.earnings", "full")
  const { data: settings, isLoading } = useQuery({
    queryKey: ["studio-ads-settings"],
    queryFn: async () => (await api.get<AdsSettings>(`${STUDIO}/ads/settings`)).data,
  })
  const { data: revenue, isLoading: revenueLoading } = useQuery({
    queryKey: ["studio-ads-revenue"],
    queryFn: async () => (await api.get<{ share_bps: number; months: AdsMonth[]; view_pool?: PoolMonth[] }>(`${STUDIO}/ads/revenue`)).data,
  })

  async function toggle(on: boolean) {
    try {
      const { data } = await api.put<{ ads_enabled: boolean }>(`${STUDIO}/ads/settings`, { ads_enabled: on })
      qc.setQueryData<AdsSettings>(["studio-ads-settings"], (old) => (old ? { ...old, ads_enabled: data.ads_enabled } : old))
      toast.success(data.ads_enabled ? t("Ads are on for your channel") : t("Ads are off for your channel"))
    } catch (err) {
      toast.error(detail(err, t("Could not change the ads setting")))
    }
  }

  if (isLoading || !settings) return <Spinner />

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="p-5 lg:col-span-3">
          <h2 className="text-sm font-bold text-navy">{t("Ads on your videos")}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {t("Brands pay to show short ads before and during long videos. You get {share} of what they spend on your videos, paid monthly.", { share: bps(settings.share_bps) })}
          </p>
          <div className="mt-3 border-t border-slate-100 pt-2">
            <ToggleField
              label={t("Show ads on my channel")}
              hint={settings.ads_enabled
                ? t("On. Every eligible video shows ads unless you turn them off for that video.")
                : t("Off. Turn it on and every eligible video shows ads; you can switch single videos off in their Monetisation tab.")}
              checked={settings.ads_enabled}
              onChange={toggle}
              disabled={!canEdit}
            />
          </div>
          {!canTakeMoney && (
            <p className="mt-2 text-xs text-amber-900">{t("Your share is only paid out once your payouts are active. It builds up until then.")}</p>
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-navy">{t("The rules")}</h2>
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
        label={t("Ad revenue by month")}
        loading={revenueLoading}
        rows={revenue?.months ?? []}
        rowKey={(r) => r.period}
        unitLabel={t("months")}
        emptyTitle={t("No ad revenue yet")}
        emptyDescription={settings.ads_enabled ? t("Ads show on eligible videos as brands run campaigns.") : t("Turn ads on to start earning from them.")}
        columns={[
          { key: "period", header: t("Month"), render: (r) => monthName(r.period, lang) },
          { key: "impressions", header: t("Ads shown"), align: "right", render: (r) => <span className="font-num">{compact(r.impressions)}</span> },
          { key: "spend", header: t("Brands spent"), align: "right", render: (r) => <span className="font-num">{inr(r.ad_spend_minor)}</span> },
          { key: "share", header: t("Your share"), align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.share_minor)}</span> },
          {
            key: "status",
            header: t("Payout"),
            render: (r) => {
              const s = PAYOUT_STATUS[r.status] ?? { label: r.status, hex: "#475569" }
              return (
                <span className="inline-flex flex-col gap-0.5">
                  <StatusPill label={t(s.label)} hex={s.hex} />
                  {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
                </span>
              )
            },
          },
        ]}
      />

      <Card className="p-5">
        <h2 className="text-sm font-bold text-navy">{t("View pool")}</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {t("Each month part of the platform's ad revenue goes into a pool for creators, shared by qualified watch time on your free videos hosted on Play. It is paid only from money brands actually spent on ads, never per view. A month with no ad revenue has no pool, and channels below a monthly minimum of watch time are left out.")}
        </p>
      </Card>
      <DataTable
        label={t("View pool by month")}
        loading={revenueLoading}
        rows={revenue?.view_pool ?? []}
        rowKey={(r) => r.period}
        unitLabel={t("months")}
        emptyTitle={t("No view pool payments yet")}
        emptyDescription={t("Your share appears here after each month's pool is paid.")}
        columns={[
          { key: "period", header: t("Month"), render: (r) => monthName(r.period, lang) },
          { key: "watch", header: t("Qualified watch time"), align: "right", render: (r) => <span className="font-num">{watchTime(r.watch_ms)}</span> },
          { key: "share", header: t("Your share"), align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.share_minor)}</span> },
          {
            key: "status",
            header: t("Payout"),
            render: (r) => {
              const s = PAYOUT_STATUS[r.status] ?? { label: r.status, hex: "#475569" }
              return (
                <span className="inline-flex flex-col gap-0.5">
                  <StatusPill label={t(s.label)} hex={s.hex} />
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
