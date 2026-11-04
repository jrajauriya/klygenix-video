import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Play } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, DataTable, Drawer, Field, Input, PageHeader, SectionHeading, Select, StatCard, Tabs, Textarea, useConfirm } from "@klygenixvideo/ui"
import { usePagedList } from "@klygenixvideo/client"
import { Row, Status, VIDEO_ADMIN, detail, fmtDuration, humanise, num, relative, useCanAct, watchUrl, when, type Tone } from "../lib/shared"
import { inr, thisMonth } from "../components/money/shared"

interface Brand {
  name: string
  contact_email: string
  website: string | null
  gstin: string | null
  state_code: string | null
  status: string
}

interface Campaign {
  id: string
  name: string
  status: string
  click_url: string
  cpm_minor: number
  budget_minor: number
  spent_minor: number
  remaining_minor: number
  refunded_minor: number
  daily_cap_minor: number | null
  start_at: string | null
  end_at: string | null
  targeting: { countries?: string[]; languages?: string[]; devices?: string[] } | null
  review_note: string | null
  created_at: string
  creative: { id: string; title: string; status: string; duration_ms: number | null } | null
  brand: Brand | null
}

interface Payout {
  tenant_id: number
  period: string
  impressions: number
  spend_minor: number
  share_bps?: number
  share_minor: number
  status: string
  note: string | null
  created_at?: string
}

interface AdReport {
  months: { period: string; impressions: number; clicks: number; spend_minor: number; creator_share_minor: number }[]
  budget_minor: number
  spent_minor: number
  share_bps: number
}

const KEY = "admin-ads-campaigns"

const CAMPAIGN_STATUS: Record<string, Tone> = {
  draft: { label: "Draft", color: "slate" },
  review: { label: "Needs review", color: "amber" },
  active: { label: "Running", color: "green" },
  paused: { label: "Paused", color: "blue" },
  rejected: { label: "Rejected", color: "red" },
  ended: { label: "Ended", color: "slate" },
}

const PAYOUT_STATUS: Record<string, Tone> = {
  pending: { label: "Pending", color: "amber" },
  released: { label: "Released", color: "green" },
  failed: { label: "Failed", color: "red" },
  skipped: { label: "Skipped", color: "slate" },
}

const STATUS_FILTER = [{ value: "", label: "Any status" }, ...Object.entries(CAMPAIGN_STATUS).map(([value, t]) => ({ value, label: t.label }))]

const TABS = [
  { key: "campaigns", label: "Campaigns" },
  { key: "report", label: "Monthly report" },
  { key: "payouts", label: "Creator payouts" },
]

function ReviewDrawer({ c, onClose }: { c: Campaign; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.ads")
  const [note, setNote] = useState("")
  const review = useMutation({
    mutationFn: async (decision: string) => (await api.post(`${VIDEO_ADMIN}/ads/campaigns/${c.id}/review`, { decision, note: note.trim() })).data,
    onSuccess: (_d, decision) => {
      toast.success(decision === "approve" ? "Approved. The campaign is running." : decision === "reject" ? "Rejected" : "Paused")
      qc.invalidateQueries({ queryKey: [KEY] })
      onClose()
    },
    onError: (err) => toast.error(detail(err, "The decision could not be saved")),
  })

  async function decide(decision: "approve" | "reject" | "pause") {
    if (decision === "reject" && note.trim().length < 3) {
      toast.error("Tell the brand why in the note")
      return
    }
    if (decision !== "approve") {
      const ok = await confirm({
        title: decision === "reject" ? "Reject this campaign?" : "Pause this campaign?",
        message: decision === "reject" ? "Ads stop and the brand sees your note. They can edit and resubmit." : "Ads stop until the brand resumes it.",
        confirmLabel: decision === "reject" ? "Reject" : "Pause",
        variant: "destructive",
      })
      if (!ok) return
    }
    review.mutate(decision)
  }

  const t = c.targeting ?? {}
  return (
    <Drawer open onClose={onClose} width="lg" title={c.name} subtitle={`${c.brand?.name ?? "Unknown brand"} · created ${when(c.created_at)}`}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Status map={CAMPAIGN_STATUS} status={c.status} />
          {c.brand?.status && c.brand.status !== "active" && <Badge color="red">Brand {c.brand.status}</Badge>}
        </div>
        <section>
          <SectionHeading>Ad</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row
              label="Video"
              wide
              value={
                c.creative ? (
                  <a href={watchUrl(c.creative.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {c.creative.title} ({fmtDuration(c.creative.duration_ms)}) <ExternalLink size={13} />
                  </a>
                ) : "No video picked"
              }
            />
            <Row label="Video status" value={c.creative ? humanise(c.creative.status) : "—"} />
            <Row label="Click goes to" value={<a href={c.click_url} target="_blank" rel="noreferrer" className="break-all text-brand hover:underline">{c.click_url}</a>} />
            <Row label="Per 1,000 views" value={inr(c.cpm_minor)} />
            <Row label="Daily cap" value={c.daily_cap_minor ? inr(c.daily_cap_minor) : "None"} />
            <Row label="Runs" value={`${c.start_at ? when(c.start_at, true) : "From approval"} to ${c.end_at ? when(c.end_at, true) : "budget end"}`} wide />
            <Row label="Countries" value={t.countries?.length ? t.countries.join(", ") : "Everywhere"} />
            <Row label="Languages" value={t.languages?.length ? t.languages.join(", ").toUpperCase() : "Any"} />
            <Row label="Devices" value={t.devices?.length ? t.devices.map(humanise).join(", ") : "All"} />
          </dl>
        </section>
        <section>
          <SectionHeading>Money</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Budget" value={inr(c.budget_minor)} />
            <Row label="Spent" value={inr(c.spent_minor)} />
            <Row label="Left" value={inr(c.remaining_minor)} />
            <Row label="Refunded" value={inr(c.refunded_minor)} />
          </dl>
        </section>
        <section>
          <SectionHeading>Brand</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Name" value={c.brand?.name} />
            <Row label="Contact" value={c.brand?.contact_email} />
            <Row label="Website" value={c.brand?.website} />
            <Row label="GSTIN" value={c.brand?.gstin} />
          </dl>
        </section>
        {c.review_note && (
          <section>
            <SectionHeading>Last review note</SectionHeading>
            <p className="text-sm text-slate-700">{c.review_note}</p>
          </section>
        )}
        {canAct && ["review", "active", "paused"].includes(c.status) && (
          <section>
            <SectionHeading>Review</SectionHeading>
            <Field label="Note to the brand" hint="Required to reject. Shown on their campaign.">
              <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {c.status === "active" && (
                <Button variant="outline" onClick={() => decide("pause")} disabled={review.isPending}>Pause</Button>
              )}
              <Button variant="destructive" onClick={() => decide("reject")} disabled={review.isPending}>Reject</Button>
              {c.status === "review" && (
                <Button onClick={() => decide("approve")} disabled={review.isPending || c.creative?.status !== "published"}>
                  {review.isPending && review.variables === "approve" ? "Approving…" : "Approve"}
                </Button>
              )}
            </div>
            {c.status === "review" && c.creative?.status !== "published" && (
              <p className="mt-2 text-xs text-amber-800">The ad video is not published yet, so it cannot be approved.</p>
            )}
          </section>
        )}
      </div>
    </Drawer>
  )
}

function Campaigns() {
  const [status, setStatus] = useState("review")
  const [open, setOpen] = useState<Campaign | null>(null)
  const list = usePagedList<Campaign>(KEY, `${VIDEO_ADMIN}/ads/campaigns`, status ? { status } : {}, 100)
  return (
    <>
      <DataTable
        label="Ad campaigns"
        loading={list.isLoading}
        rows={list.rows}
        rowKey={(r) => r.id}
        serverTotal={list.total}
        onServerPage={list.onServerPage}
        pageSize={list.pageSize}
        unitLabel="campaigns"
        emptyTitle={status === "review" ? "Nothing waiting for review" : "No campaigns"}
        onRowClick={(r) => setOpen(r)}
        toolbarRight={<Select value={status} onChange={setStatus} options={STATUS_FILTER} aria-label="Status" className="w-40" />}
        columns={[
          {
            key: "name",
            header: "Campaign",
            render: (r) => (
              <span className="block min-w-0">
                <span className="block max-w-xs truncate font-medium text-navy">{r.name}</span>
                <span className="block truncate text-xs text-slate-500">{r.brand?.name ?? "Unknown brand"}</span>
              </span>
            ),
          },
          { key: "status", header: "Status", render: (r) => <Status map={CAMPAIGN_STATUS} status={r.status} /> },
          { key: "cpm", header: "CPM", align: "right", render: (r) => <span className="font-num">{inr(r.cpm_minor)}</span> },
          { key: "budget", header: "Budget", align: "right", render: (r) => <span className="font-num">{inr(r.budget_minor)}</span> },
          { key: "spent", header: "Spent", align: "right", render: (r) => <span className="font-num">{inr(r.spent_minor)}</span> },
          { key: "created", header: "Created", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
        ]}
      />
      {open && <ReviewDrawer key={open.id} c={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function Report() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ads-report"],
    queryFn: async () => (await api.get<AdReport>(`${VIDEO_ADMIN}/ads/report`)).data,
    retry: false,
  })
  if (isError) return <Card className="p-5 text-sm text-red-700">The advertising report could not be loaded.</Card>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard size="sm" label="Funded by brands" value={data ? inr(data.budget_minor) : "—"} accent="navy" />
        <StatCard size="sm" label="Spent on ads" value={data ? inr(data.spent_minor) : "—"} accent="brand" />
        <StatCard size="sm" label="Unspent" value={data ? inr(data.budget_minor - data.spent_minor) : "—"} accent="blue" />
        <StatCard size="sm" label="Creator share" value={data ? `${data.share_bps / 100}%` : "—"} accent="green" />
      </div>
      <DataTable
        label="Advertising by month"
        loading={isLoading}
        rows={data?.months ?? []}
        rowKey={(r) => r.period}
        unitLabel="months"
        emptyTitle="No ads shown yet"
        columns={[
          { key: "period", header: "Month", render: (r) => <span className="font-num">{r.period}</span> },
          { key: "imp", header: "Ads shown", align: "right", render: (r) => <span className="font-num">{num(r.impressions)}</span> },
          { key: "clicks", header: "Clicks", align: "right", render: (r) => <span className="font-num">{num(r.clicks)}</span> },
          { key: "ctr", header: "CTR", align: "right", render: (r) => <span className="font-num">{r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(2)}%` : "—"}</span> },
          { key: "spend", header: "Spend", align: "right", render: (r) => <span className="font-num">{inr(r.spend_minor)}</span> },
          { key: "share", header: "Creators' share", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.creator_share_minor)}</span> },
          { key: "kept", header: "Platform keeps", align: "right", render: (r) => <span className="font-num">{inr(r.spend_minor - r.creator_share_minor)}</span> },
        ]}
      />
    </div>
  )
}

function lastMonth(): string {
  const [y, m] = thisMonth().split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}

function Payouts() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.ads")
  const [period, setPeriod] = useState("")
  const [runFor, setRunFor] = useState(lastMonth())
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-ads-payouts", period],
    queryFn: async () => (await api.get<Payout[]>(`${VIDEO_ADMIN}/ads/payouts`, { params: period ? { period } : {} })).data,
  })
  const run = useMutation({
    mutationFn: async () => (await api.post<Payout[]>(`${VIDEO_ADMIN}/ads/payouts/run`, { period: runFor })).data,
    onSuccess: (d) => {
      toast.success(`${d.length} creator payout${d.length === 1 ? "" : "s"} for ${runFor}`)
      qc.invalidateQueries({ queryKey: ["admin-ads-payouts"] })
    },
    onError: (err) => toast.error(detail(err, "The payouts could not be run")),
  })

  async function ask() {
    const ok = await confirm({
      title: `Pay creators their ad share for ${runFor}?`,
      message: "Each creator with ad revenue that month gets a transfer to their payout account. Running it again for the same month does not pay twice.",
      confirmLabel: "Run payouts",
    })
    if (ok) run.mutate()
  }

  return (
    <div className="space-y-4">
      {canAct && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Month to pay" className="w-44">
            <Input type="month" value={runFor} max={thisMonth()} onChange={(e) => setRunFor(e.target.value)} />
          </Field>
          <Button onClick={ask} disabled={run.isPending || !/^\d{4}-\d{2}$/.test(runFor)}>
            <Play size={14} /> {run.isPending ? "Running…" : "Run payouts"}
          </Button>
          <p className="min-w-0 flex-1 text-xs text-slate-500">The scheduler runs this on the first of each month for the month before. Run it by hand only if that was missed.</p>
        </Card>
      )}
      <DataTable
        label="Creator ad payouts"
        loading={isLoading}
        rows={rows}
        rowKey={(r) => `${r.tenant_id}-${r.period}`}
        unitLabel="payouts"
        emptyTitle="No payouts"
        toolbarRight={
          <Input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} aria-label="Filter by month" className="w-44" />
        }
        columns={[
          { key: "tenant", header: "Account", render: (r) => <span className="font-num">#{r.tenant_id}</span> },
          { key: "period", header: "Month", render: (r) => <span className="font-num">{r.period}</span> },
          { key: "imp", header: "Ads shown", align: "right", render: (r) => <span className="font-num">{num(r.impressions)}</span> },
          { key: "spend", header: "Spend", align: "right", render: (r) => <span className="font-num">{inr(r.spend_minor)}</span> },
          { key: "share", header: "Creator share", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.share_minor)}</span> },
          {
            key: "status",
            header: "Status",
            render: (r) => (
              <span className="inline-flex flex-col gap-0.5">
                <Status map={PAYOUT_STATUS} status={r.status} />
                {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
              </span>
            ),
          },
        ]}
      />
    </div>
  )
}

export default function Advertising() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "campaigns"
  return (
    <>
      <PageHeader title="Advertising" subtitle="Brand campaigns, what they spent, and the creators' share" />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setParams(k === "campaigns" ? {} : { tab: k }, { replace: true })} />
      <div className="pb-8">
        {tab === "campaigns" && <Campaigns />}
        {tab === "report" && <Report />}
        {tab === "payouts" && <Payouts />}
      </div>
    </>
  )
}
