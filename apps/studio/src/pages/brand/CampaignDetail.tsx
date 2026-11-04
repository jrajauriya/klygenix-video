import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Pause, Pencil, Play, Send, Square, Wallet } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, DataTable, EmptyState, PageHeader, Spinner, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { clock, compact, detail, languageName, watchUrl, when } from "../../lib/format"
import { bps, type Campaign } from "../../lib/market"
import { CampaignStatusPill, Stat } from "../../components/brand/shared"
import { CampaignForm } from "../../components/brand/CampaignForm"
import { FundCampaign } from "../../components/brand/FundCampaign"
import { inr } from "../../components/earnings/shared"

export default function CampaignDetail() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.brand", "full")
  const [editing, setEditing] = useState(false)
  const [funding, setFunding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const { data: c, isLoading, isError } = useQuery({
    queryKey: ["studio-campaign", id],
    queryFn: async () => (await api.get<Campaign>(`${STUDIO}/ads/campaigns/${id}`)).data,
    retry: false,
  })

  if (isLoading) return <Spinner />
  if (isError || !c) return <EmptyState title="Campaign not found" hint="It may belong to another account." />

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
      toast.error(detail(err, "That did not work"))
    } finally {
      setBusy(null)
    }
  }

  const submit = () =>
    run("submit", async () => (await api.post(`${STUDIO}/ads/campaigns/${c.id}/submit`)).data, () => "Sent for review. We usually review within a working day.")

  const state = (action: "pause" | "resume") =>
    run(action, async () => (await api.post(`${STUDIO}/ads/campaigns/${c.id}/state`, { action })).data,
      () => (action === "pause" ? "Campaign paused" : "Campaign running again"))

  async function end() {
    const ok = await confirm({
      title: "End this campaign?",
      message: `Ads stop now and cannot be restarted. ${c!.remaining_minor > 0 ? `The unspent ${inr(c!.remaining_minor)} is refunded to you.` : ""}`,
      confirmLabel: "End campaign",
      variant: "destructive",
    })
    if (!ok) return
    run("end", async () => (await api.post(`${STUDIO}/ads/campaigns/${c!.id}/state`, { action: "end" })).data,
      (d) => (d.refunded_now_minor ? `Campaign ended. ${inr(d.refunded_now_minor)} refunded.` : "Campaign ended"))
  }

  const totals = c.report?.totals
  const days = [...(c.report?.days ?? [])].reverse()
  const t = c.targeting ?? {}
  const editable = ["draft", "rejected", "paused"].includes(c.status)

  return (
    <div className="pb-8">
      <PageHeader
        title={c.name}
        subtitle={`Created ${when(c.created_at)}`}
        onBack={() => navigate("/brand/campaigns")}
        actions={
          <>
            <CampaignStatusPill status={c.status} />
            {canEdit && editable && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
            )}
            {canEdit && (c.status === "draft" || c.status === "rejected") && (
              <Button size="sm" onClick={submit} disabled={busy !== null || !c.creative}>
                <Send size={14} /> {busy === "submit" ? "Sending…" : "Submit for review"}
              </Button>
            )}
            {canEdit && c.status === "active" && (
              <Button variant="outline" size="sm" onClick={() => state("pause")} disabled={busy !== null}><Pause size={14} /> Pause</Button>
            )}
            {canEdit && c.status === "paused" && (
              <Button variant="outline" size="sm" onClick={() => state("resume")} disabled={busy !== null}><Play size={14} /> Resume</Button>
            )}
            {canEdit && c.status !== "ended" && (
              <Button size="sm" onClick={() => setFunding(true)} disabled={busy !== null}><Wallet size={14} /> Add funds</Button>
            )}
            {canEdit && c.status !== "ended" && (
              <Button variant="ghost" size="sm" className="text-red-700" onClick={end} disabled={busy !== null}><Square size={14} /> End</Button>
            )}
          </>
        }
      />

      {c.status === "rejected" && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          Not approved{c.review_note ? `: ${c.review_note}` : "."} Edit the campaign and submit it again.
        </p>
      )}
      {c.status === "review" && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          Waiting for review. Ads start once it is approved{c.budget_minor > 0 ? "" : " and the campaign has funds"}.
        </p>
      )}
      {c.status === "draft" && !c.creative && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          Pick an ad video before you submit the campaign for review.
        </p>
      )}
      {c.status !== "review" && c.status !== "rejected" && c.review_note && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">Note: {c.review_note}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Budget" value={inr(c.budget_minor)} hint={c.refunded_minor ? `${inr(c.refunded_minor)} refunded` : undefined} />
        <Stat label="Spent" value={inr(c.spent_minor)} />
        <Stat label="Left" value={inr(c.remaining_minor)} />
        <Stat label="Per 1,000 views" value={inr(c.cpm_minor)} hint={c.daily_cap_minor ? `Cap ${inr(c.daily_cap_minor)} a day` : "No daily cap"} />
      </div>
      {totals && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Ads shown" value={compact(totals.impressions)} />
          <Stat label="Watched to the end" value={bps(totals.completion_bps)} hint={`${compact(totals.completes)} views · ${compact(totals.skips)} skipped`} />
          <Stat label="Clicks" value={compact(totals.clicks)} />
          <Stat label="Click-through rate" value={bps(totals.ctr_bps)} />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="lg:col-span-2">
          <DataTable
            label="Daily results"
            rows={days}
            rowKey={(r) => r.day}
            unitLabel="days"
            emptyTitle="No results yet"
            emptyDescription="Daily numbers appear once the ad starts showing."
            columns={[
              { key: "day", header: "Day", render: (r) => when(r.day) },
              { key: "imp", header: "Shown", align: "right", render: (r) => <span className="font-num">{compact(r.impressions)}</span> },
              { key: "done", header: "Completed", align: "right", render: (r) => <span className="font-num">{compact(r.completes)}</span> },
              { key: "skip", header: "Skipped", align: "right", render: (r) => <span className="font-num">{compact(r.skips)}</span> },
              { key: "click", header: "Clicks", align: "right", render: (r) => <span className="font-num">{compact(r.clicks)}</span> },
              { key: "spend", header: "Spent", align: "right", render: (r) => <span className="font-num">{inr(r.spend_minor)}</span> },
            ]}
          />
        </div>
        <Card className="h-fit space-y-3 p-5 text-sm">
          <h2 className="text-sm font-bold text-navy">Setup</h2>
          <dl className="space-y-2.5">
            <div>
              <dt className="text-xs text-slate-500">Ad video</dt>
              <dd className="text-slate-800">
                {c.creative ? (
                  <a href={watchUrl(c.creative.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    {c.creative.title} ({clock(c.creative.duration_ms)}) <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : "None yet"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Click goes to</dt>
              <dd className="break-all text-slate-800">{c.click_url}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Runs</dt>
              <dd className="text-slate-800">
                {c.start_at ? when(c.start_at, true) : "From approval"} to {c.end_at ? when(c.end_at, true) : "budget end"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Countries</dt>
              <dd className="text-slate-800">{t.countries?.length ? t.countries.join(", ") : "Everywhere"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Languages</dt>
              <dd className="text-slate-800">{t.languages?.length ? t.languages.map(languageName).join(", ") : "Any"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Devices</dt>
              <dd className="capitalize text-slate-800">{t.devices?.length ? t.devices.join(", ") : "All"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Skippable after</dt>
              <dd className="text-slate-800">{c.skip_after_seconds} seconds</dd>
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
