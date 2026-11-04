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
  kind?: "ad_share" | "view_pool" | string
  watch_ms?: number
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

interface Ivt {
  reasons: Record<string, number>
  billable: number
  invalid: number
  campaigns: { id: string; name: string; impressions: number; invalid: number }[]
}

interface PoolPreview {
  period: string
  ad_spend_minor: number
  creator_ad_share_minor: number
  net_ad_revenue_minor: number
  pool_bps: number
  pool_minor: number
  allocated_minor: number
  min_minutes: number
  below_floor: number
  creators: { tenant_id: number; qualified_ms: number; share_bps: number; amount_minor: number; payouts_ready: boolean }[]
}

interface PoolRow {
  tenant_id: number
  period: string
  watch_ms: number
  share_bps: number
  share_minor: number
  status: string
  note: string | null
}

const KEY = "admin-ads-campaigns"

const IVT_REASON: Record<string, string> = {
  bot_ua: "Bot or crawler user agent",
  too_fast: "Events faster than a person can watch",
  complete_too_fast: "Completed before the ad could finish",
  viewer_mismatch: "Viewer changed mid-ad",
  no_start: "Impression with no start",
  datacentre: "Data-centre network",
  burst: "Burst from one viewer",
  after_invalid: "After an invalid event",
}

const KIND: Record<string, Tone> = {
  ad_share: { label: "Ad share", color: "blue" },
  view_pool: { label: "View pool", color: "purple" },
}

const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(2).replace(/\.00$/, "")}%` : "—")

const watchHours = (ms: number | null | undefined) => {
  const h = (ms ?? 0) / 3_600_000
  return h >= 10 ? `${num(Math.round(h))} h` : `${h.toFixed(1)} h`
}

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
  { key: "ivt", label: "Invalid traffic" },
  { key: "pool", label: "View pool" },
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
        rowKey={(r) => `${r.tenant_id}-${r.period}-${r.kind ?? "ad_share"}`}
        unitLabel="payouts"
        emptyTitle="No payouts"
        toolbarRight={
          <Input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} aria-label="Filter by month" className="w-44" />
        }
        columns={[
          { key: "tenant", header: "Account", render: (r) => <span className="font-num">#{r.tenant_id}</span> },
          { key: "period", header: "Month", render: (r) => <span className="font-num">{r.period}</span> },
          { key: "kind", header: "Kind", render: (r) => <Status map={KIND} status={r.kind ?? "ad_share"} /> },
          {
            key: "imp",
            header: "Ads shown / watch time",
            align: "right",
            render: (r) => <span className="font-num">{r.kind === "view_pool" ? watchHours(r.watch_ms) : num(r.impressions)}</span>,
          },
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

function InvalidTraffic() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ads-ivt"],
    queryFn: async () => (await api.get<Ivt>(`${VIDEO_ADMIN}/ads/ivt`)).data,
    retry: false,
  })
  if (isError) return <Card className="p-5 text-sm text-red-700">Invalid traffic figures could not be loaded.</Card>
  const total = (data?.billable ?? 0) + (data?.invalid ?? 0)
  const reasons = Object.entries(data?.reasons ?? {})
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n)
  const flagged = reasons.reduce((s, r) => s + r.n, 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard size="sm" label="Billable impressions" value={data ? num(data.billable) : "—"} accent="green" />
        <StatCard size="sm" label="Invalid impressions" value={data ? num(data.invalid) : "—"} accent="red" />
        <StatCard size="sm" label="Invalid share" value={data ? pct(data.invalid, total) : "—"} accent="navy" />
        <StatCard size="sm" label="Reasons flagged" value={data ? num(flagged) : "—"} accent="blue" />
      </div>
      <p className="text-xs text-slate-500">Invalid impressions are never billed to the brand and never count towards a creator's share. One impression can carry more than one reason.</p>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <DataTable
          label="Why impressions were invalid"
          loading={isLoading}
          rows={reasons}
          rowKey={(r) => r.reason}
          unitLabel="reasons"
          emptyTitle="No invalid traffic"
          columns={[
            {
              key: "reason",
              header: "Reason",
              render: (r) => (
                <span className="block min-w-0">
                  <span className="block font-medium text-navy">{IVT_REASON[r.reason] ?? humanise(r.reason)}</span>
                  <span className="block font-mono text-xs text-slate-500">{r.reason}</span>
                </span>
              ),
            },
            { key: "n", header: "Count", align: "right", render: (r) => <span className="font-num">{num(r.n)}</span> },
            { key: "share", header: "Of flagged", align: "right", render: (r) => <span className="font-num">{pct(r.n, flagged)}</span> },
          ]}
        />
        <DataTable
          label="Campaigns with the most invalid traffic"
          loading={isLoading}
          rows={data?.campaigns ?? []}
          rowKey={(r) => r.id}
          unitLabel="campaigns"
          emptyTitle="No campaigns have shown ads yet"
          columns={[
            { key: "name", header: "Campaign", render: (r) => <span className="block max-w-xs truncate font-medium text-navy">{r.name}</span> },
            { key: "imp", header: "Billable", align: "right", render: (r) => <span className="font-num">{num(r.impressions)}</span> },
            { key: "inv", header: "Invalid", align: "right", render: (r) => <span className="font-num">{num(r.invalid)}</span> },
            { key: "share", header: "Invalid share", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{pct(r.invalid, r.invalid + r.impressions)}</span> },
          ]}
        />
      </div>
    </div>
  )
}

const POOL_STATUS: Record<string, Tone> = {
  ...PAYOUT_STATUS,
  held: { label: "Held", color: "amber" },
}

function ViewPool() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.ads")
  const [period, setPeriod] = useState(lastMonth())
  const [ran, setRan] = useState<PoolRow[] | null>(null)
  const valid = /^\d{4}-\d{2}$/.test(period)
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ads-pool", period],
    queryFn: async () => (await api.get<PoolPreview>(`${VIDEO_ADMIN}/ads/view-pool/preview`, { params: { period } })).data,
    enabled: valid,
    retry: false,
  })
  const run = useMutation({
    mutationFn: async () => (await api.post<PoolRow[]>(`${VIDEO_ADMIN}/ads/view-pool/run`, { period })).data,
    onSuccess: (rows) => {
      setRan(rows)
      toast.success(`${rows.length} view pool payout${rows.length === 1 ? "" : "s"} for ${period}`)
      qc.invalidateQueries({ queryKey: ["admin-ads-payouts"] })
      qc.invalidateQueries({ queryKey: ["admin-ads-pool", period] })
    },
    onError: (err) => toast.error(detail(err, "The view pool could not be paid")),
  })

  async function ask() {
    const ok = await confirm({
      title: `Pay the view pool for ${period}?`,
      message: `${data ? inr(data.allocated_minor) : "The pool"} is split between ${data?.creators.length ?? 0} creators by qualified watch time. Creators without active payouts are held. Running it again for the same month does not pay twice.`,
      confirmLabel: "Pay the view pool",
    })
    if (ok) run.mutate()
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Month" className="w-44">
          <Input type="month" value={period} max={thisMonth()} onChange={(e) => { setPeriod(e.target.value); setRan(null) }} />
        </Field>
        {canAct && (
          <Button onClick={ask} disabled={run.isPending || !valid || !data || data.creators.length === 0}>
            <Play size={14} /> {run.isPending ? "Paying…" : "Pay the view pool"}
          </Button>
        )}
        <p className="min-w-0 flex-1 text-xs text-slate-500">
          The pool is a share of net ad revenue, paid only from what brands actually spent. It is split by qualified watch time on free, hosted videos; never per view.
        </p>
      </Card>
      {isError && <Card className="p-5 text-sm text-red-700">The view pool preview could not be loaded.</Card>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard size="sm" label="Brands spent" value={data ? inr(data.ad_spend_minor) : "—"} accent="navy" />
        <StatCard size="sm" label="Net ad revenue" value={data ? inr(data.net_ad_revenue_minor) : "—"} hint={data ? `After ${inr(data.creator_ad_share_minor)} ad share` : undefined} accent="blue" />
        <StatCard size="sm" label="View pool" value={data ? inr(data.pool_minor) : "—"} hint={data ? `${data.pool_bps / 100}% of net` : undefined} accent="brand" />
        <StatCard size="sm" label="Allocated" value={data ? inr(data.allocated_minor) : "—"} hint={data ? `${num(data.below_floor)} below the ${data.min_minutes}-minute floor` : undefined} accent="green" />
      </div>
      {ran ? (
        <DataTable
          label="View pool payouts just run"
          rows={ran}
          rowKey={(r) => `${r.tenant_id}-${r.period}`}
          unitLabel="payouts"
          emptyTitle="No creator qualified"
          toolbarRight={<Button variant="outline" size="sm" onClick={() => setRan(null)}>Back to the preview</Button>}
          columns={[
            { key: "tenant", header: "Account", render: (r) => <span className="font-num">#{r.tenant_id}</span> },
            { key: "watch", header: "Qualified watch time", align: "right", render: (r) => <span className="font-num">{watchHours(r.watch_ms)}</span> },
            { key: "bps", header: "Share", align: "right", render: (r) => <span className="font-num">{(r.share_bps / 100).toFixed(2)}%</span> },
            { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.share_minor)}</span> },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <span className="inline-flex flex-col gap-0.5">
                  <Status map={POOL_STATUS} status={r.status} />
                  {r.note && <span className="text-xs text-slate-500">{r.note}</span>}
                </span>
              ),
            },
          ]}
        />
      ) : (
        <DataTable
          label="Creators in the pool"
          loading={isLoading}
          rows={data?.creators ?? []}
          rowKey={(r) => String(r.tenant_id)}
          unitLabel="creators"
          emptyTitle="No creator qualifies this month"
          emptyDescription={data ? `A creator needs at least ${data.min_minutes} minutes of qualified watch time.` : undefined}
          columns={[
            { key: "tenant", header: "Account", render: (r) => <span className="font-num">#{r.tenant_id}</span> },
            { key: "watch", header: "Qualified watch time", align: "right", render: (r) => <span className="font-num">{watchHours(r.qualified_ms)}</span> },
            { key: "bps", header: "Share", align: "right", render: (r) => <span className="font-num">{(r.share_bps / 100).toFixed(2)}%</span> },
            { key: "amount", header: "Amount", align: "right", render: (r) => <span className="font-num font-semibold text-navy">{inr(r.amount_minor)}</span> },
            {
              key: "ready",
              header: "Payouts",
              render: (r) => (r.payouts_ready ? <Badge color="green">Active</Badge> : <Badge color="amber">Not set up, held</Badge>),
            },
          ]}
        />
      )}
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
        {tab === "ivt" && <InvalidTraffic />}
        {tab === "pool" && <ViewPool />}
      </div>
    </>
  )
}
