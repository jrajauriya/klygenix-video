import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, ExternalLink, Pause, Pencil, Play, Send, Square, Wallet } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, DataTable, EmptyState, PageHeader, Spinner, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "../../lib/team"
import { ViewOnly } from "../../components/team/ViewOnly"
import { STUDIO } from "../../lib/hooks"
import { clock, compact, detail, languageName, watchUrl, when } from "../../lib/format"
import { DEVICES, bps, categoryLabel, type Campaign } from "../../lib/market"
import { download } from "../../lib/download"
import { CampaignStatusPill, Stat } from "../../components/brand/shared"
import { CampaignForm } from "../../components/brand/CampaignForm"
import { FundCampaign } from "../../components/brand/FundCampaign"
import { inr } from "../../components/earnings/shared"
import { useT } from "../../i18n"

export default function CampaignDetail() {
  const t = useT()
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.brand", "full")
  const [editing, setEditing] = useState(false)
  const [funding, setFunding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const { data: c, isLoading, isError } = useQuery({
    queryKey: ["studio-campaign", id],
    queryFn: async () => (await api.get<Campaign>(`${STUDIO}/ads/campaigns/${id}`)).data,
    retry: false,
  })

  if (isLoading) return <Spinner />
  if (isError || !c) return <EmptyState title={t("Campaign not found")} hint={t("It may belong to another account.")} />

  const refresh = (data?: Campaign) => {
    if (data) qc.setQueryData(["studio-campaign", id], (old: Campaign | undefined) => ({ ...old, ...data }))
    qc.invalidateQueries({ queryKey: ["studio-campaign", id] })
    qc.invalidateQueries({ queryKey: ["studio-campaigns"] })
  }

  async function run(label: string, fn: () => Promise<Campaign & { refunded_now_minor?: number }>, success: (d: Campaign & { refunded_now_minor?: number }) => string) {
    setBusy(label)
    try {
      const data = await fn()
      toast.success(success(data))
      refresh(data)
    } catch (err) {
      toast.error(detail(err, t("That did not work")))
    } finally {
      setBusy(null)
    }
  }

  const submit = () =>
    run("submit", async () => (await api.post(`${STUDIO}/ads/campaigns/${c.id}/submit`)).data, () => t("Sent for review. We usually review within a working day."))

  const state = (action: "pause" | "resume") =>
    run(action, async () => (await api.post(`${STUDIO}/ads/campaigns/${c.id}/state`, { action })).data,
      () => (action === "pause" ? t("Campaign paused") : t("Campaign running again")))

  async function end() {
    const ok = await confirm({
      title: t("End this campaign?"),
      message: c!.remaining_minor > 0
        ? t("Ads stop now and cannot be restarted. The unspent {amount} is refunded to you.", { amount: inr(c!.remaining_minor) })
        : t("Ads stop now and cannot be restarted."),
      confirmLabel: t("End campaign"),
      variant: "destructive",
    })
    if (!ok) return
    run("end", async () => (await api.post(`${STUDIO}/ads/campaigns/${c!.id}/state`, { action: "end" })).data,
      (d) => (d.refunded_now_minor ? t("Campaign ended. {amount} refunded.", { amount: inr(d.refunded_now_minor) }) : t("Campaign ended")))
  }

  async function exportCsv(by: "day" | "category" | "device") {
    setExporting(by)
    try {
      await download(`${STUDIO}/ads/campaigns/${c!.id}/export?by=${by}`, `campaign-${c!.id}-${by}.csv`)
    } catch (err) {
      toast.error(detail(err, t("The export could not be downloaded")))
    } finally {
      setExporting(null)
    }
  }

  const totals = c.report?.totals
  const days = [...(c.report?.days ?? [])].reverse()
  const targeting = c.targeting ?? {}
  const editable = ["draft", "rejected", "paused"].includes(c.status)

  return (
    <div className="pb-8">
      <PageHeader
        title={c.name}
        subtitle={t("Created {date}", { date: when(c.created_at) })}
        onBack={() => navigate("/brand/campaigns")}
        actions={
          <>
            <CampaignStatusPill status={c.status} />
            {canEdit && editable && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil size={14} /> {t("Edit")}</Button>
            )}
            {canEdit && (c.status === "draft" || c.status === "rejected") && (
              <Button size="sm" onClick={submit} disabled={busy !== null || !c.creative}>
                <Send size={14} /> {busy === "submit" ? t("Sending…") : t("Submit for review")}
              </Button>
            )}
            {canEdit && c.status === "active" && (
              <Button variant="outline" size="sm" onClick={() => state("pause")} disabled={busy !== null}><Pause size={14} /> {t("Pause")}</Button>
            )}
            {canEdit && c.status === "paused" && (
              <Button variant="outline" size="sm" onClick={() => state("resume")} disabled={busy !== null}><Play size={14} /> {t("Resume")}</Button>
            )}
            {canEdit && c.status !== "ended" && (
              <Button size="sm" onClick={() => setFunding(true)} disabled={busy !== null}><Wallet size={14} /> {t("Add funds")}</Button>
            )}
            {canEdit && c.status !== "ended" && (
              <Button variant="ghost" size="sm" className="text-red-700" onClick={end} disabled={busy !== null}><Square size={14} /> {t("End")}</Button>
            )}
          </>
        }
      />

      {!canEdit && <ViewOnly className="mb-4" what={t("Your role can see campaigns and their results but not create, fund or change them.")} />}
      {c.status === "rejected" && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          {c.review_note
            ? t("Not approved: {note} Edit the campaign and submit it again.", { note: c.review_note })
            : t("Not approved. Edit the campaign and submit it again.")}
        </p>
      )}
      {c.status === "review" && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          {c.budget_minor > 0
            ? t("Waiting for review. Ads start once it is approved.")
            : t("Waiting for review. Ads start once it is approved and the campaign has funds.")}
        </p>
      )}
      {c.status === "draft" && !c.creative && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          {t("Pick an ad video before you submit the campaign for review.")}
        </p>
      )}
      {c.status !== "review" && c.status !== "rejected" && c.review_note && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">{t("Note: {note}", { note: c.review_note })}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Budget")} value={inr(c.budget_minor)} hint={c.refunded_minor ? t("{amount} refunded", { amount: inr(c.refunded_minor) }) : undefined} />
        <Stat label={t("Spent")} value={inr(c.spent_minor)} />
        <Stat label={t("Left")} value={inr(c.remaining_minor)} />
        <Stat label={t("Per 1,000 views")} value={inr(c.cpm_minor)} hint={c.daily_cap_minor ? t("Cap {amount} a day", { amount: inr(c.daily_cap_minor) }) : t("No daily cap")} />
      </div>
      {totals && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Ads shown")} value={compact(totals.impressions)} hint={totals.starts !== undefined ? t("{n} started playing", { n: compact(totals.starts) }) : undefined} />
          <Stat
            label={t("Invalid traffic")}
            value={bps(totals.invalid_bps ?? 0)}
            hint={t("{invalid} not billed · {viewable} viewable", { invalid: compact(totals.invalid ?? 0), viewable: compact(totals.impressions) })}
          />
          <Stat label={t("Watched to the end")} value={bps(totals.completion_bps)} hint={t("{views} views · {skips} skipped", { views: compact(totals.completes), skips: compact(totals.skips) })} />
          <Stat label={t("Clicks")} value={compact(totals.clicks)} hint={t("{rate} click-through rate", { rate: bps(totals.ctr_bps) })} />
        </div>
      )}
      {totals && (totals.invalid ?? 0) > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {t("Invalid traffic is impressions from bots, data centres or replayed requests. You are never charged for it and it never counts as a view.")}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{t("Export CSV")}</span>
            {(["day", "category", "device"] as const).map((by) => (
              <Button key={by} size="sm" variant="outline" disabled={exporting !== null} onClick={() => exportCsv(by)}>
                <Download size={13} aria-hidden="true" /> {exporting === by ? t("Downloading…") : by === "day" ? t("By day") : by === "category" ? t("By category") : t("By device")}
              </Button>
            ))}
          </div>
          <DataTable
            label={t("Daily results")}
            rows={days}
            rowKey={(r) => r.day}
            unitLabel={t("days")}
            emptyTitle={t("No results yet")}
            emptyDescription={t("Daily numbers appear once the ad starts showing.")}
            columns={[
              { key: "day", header: t("Day"), render: (r) => when(r.day) },
              { key: "imp", header: t("Viewable"), align: "right", render: (r) => <span className="font-num">{compact(r.impressions)}</span> },
              { key: "start", header: t("Started"), align: "right", render: (r) => <span className="font-num">{compact(r.starts ?? 0)}</span> },
              { key: "invalid", header: t("Invalid"), align: "right", render: (r) => <span className="font-num text-slate-500">{compact(r.invalid ?? 0)}</span> },
              { key: "done", header: t("Completed"), align: "right", render: (r) => <span className="font-num">{compact(r.completes)}</span> },
              { key: "skip", header: t("Skipped"), align: "right", render: (r) => <span className="font-num">{compact(r.skips)}</span> },
              { key: "click", header: t("Clicks"), align: "right", render: (r) => <span className="font-num">{compact(r.clicks)}</span> },
              { key: "spend", header: t("Spent"), align: "right", render: (r) => <span className="font-num">{inr(r.spend_minor)}</span> },
            ]}
          />
        </div>
        <Card className="h-fit space-y-3 p-5 text-sm">
          <h2 className="text-sm font-bold text-navy">{t("Setup")}</h2>
          <dl className="space-y-2.5">
            <div>
              <dt className="text-xs text-slate-500">{t("Ad video")}</dt>
              <dd className="text-slate-800">
                {c.creative ? (
                  <a href={watchUrl(c.creative.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    {c.creative.title} ({clock(c.creative.duration_ms)}) <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : t("None yet")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Click goes to")}</dt>
              <dd className="break-all text-slate-800">{c.click_url}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Runs")}</dt>
              <dd className="text-slate-800">
                {t("{from} to {to}", { from: c.start_at ? when(c.start_at, true) : t("From approval"), to: c.end_at ? when(c.end_at, true) : t("budget end") })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Countries")}</dt>
              <dd className="text-slate-800">{targeting.countries?.length ? targeting.countries.join(", ") : t("Everywhere")}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Languages")}</dt>
              <dd className="text-slate-800">{targeting.languages?.length ? targeting.languages.map(languageName).join(", ") : t("Any")}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Devices")}</dt>
              <dd className="capitalize text-slate-800">{targeting.devices?.length ? targeting.devices.map((d) => { const label = DEVICES.find((x) => x.value === d)?.label; return label ? t(label) : d }).join(", ") : t("All")}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Never on")}</dt>
              <dd className="text-slate-800">{c.exclude_categories?.length ? c.exclude_categories.map(categoryLabel).join(", ") : t("No excluded categories")}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("Skippable after")}</dt>
              <dd className="text-slate-800">{t("{n} seconds", { n: c.skip_after_seconds })}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {editing && (
        <CampaignForm
          campaign={c}
          onClose={() => setEditing(false)}
          onSaved={(d) => {
            setEditing(false)
            refresh(d)
          }}
        />
      )}
      {funding && (
        <FundCampaign
          campaign={c}
          onClose={() => setFunding(false)}
          onPaid={() => {
            setFunding(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
