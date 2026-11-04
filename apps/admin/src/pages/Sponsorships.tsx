import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Drawer, Field, PageHeader, SectionHeading, Select, Textarea, useConfirm } from "@klygenixvideo/ui"
import { Note, Row, Status, VIDEO_ADMIN, WEB_URL, detail, relative, useCanAct, watchUrl, when, type Tone } from "../lib/shared"
import { inr } from "../components/money/shared"

interface Deal {
  id: string
  title: string
  deliverables: string
  price_minor: number
  status: string
  channel: { id: number; handle: string; name: string; followers: number } | null
  brand: { name: string } | null
  video: { id: string; title: string } | null
  funded_at: string | null
  delivered_at: string | null
  approve_by: string | null
  approved_at: string | null
  auto_approved: boolean
  dispute_reason: string | null
  resolution_note: string | null
  created_at: string
}

const KEY = "admin-sponsorship-deals"

const DEAL_STATUS: Record<string, Tone> = {
  proposed: { label: "Waiting for funds", color: "slate" },
  funded: { label: "Funded", color: "blue" },
  delivered: { label: "Delivered", color: "purple" },
  approved: { label: "Approved", color: "green" },
  disputed: { label: "Disputed", color: "red" },
  refunded: { label: "Refunded", color: "slate" },
  cancelled: { label: "Cancelled", color: "slate" },
}

const FILTER = [{ value: "", label: "Any status" }, ...Object.entries(DEAL_STATUS).map(([value, t]) => ({ value, label: t.label }))]

function DealDrawer({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.sponsorships")
  const [note, setNote] = useState("")
  const resolve = useMutation({
    mutationFn: async (decision: "release" | "refund") =>
      (await api.post(`${VIDEO_ADMIN}/sponsorships/deals/${deal.id}/resolve`, { decision, note: note.trim() })).data,
    onSuccess: (_d, decision) => {
      toast.success(decision === "release" ? "Released to the creator" : "Refunded to the brand")
      qc.invalidateQueries({ queryKey: [KEY] })
      onClose()
    },
    onError: (err) => toast.error(detail(err, "The dispute could not be resolved")),
  })

  async function decide(decision: "release" | "refund") {
    const ok = await confirm({
      title: decision === "release" ? "Release the money to the creator?" : "Refund the brand?",
      message:
        decision === "release"
          ? `${inr(deal.price_minor)} goes to ${deal.channel?.name ?? "the creator"}, less commission. The brand is told why.`
          : `${inr(deal.price_minor)} goes back to ${deal.brand?.name ?? "the brand"}. The creator is told why.`,
      confirmLabel: decision === "release" ? "Release" : "Refund",
      variant: decision === "refund" ? "destructive" : "default",
    })
    if (ok) resolve.mutate(decision)
  }

  return (
    <Drawer open onClose={onClose} width="lg" title={deal.title} subtitle={`${deal.brand?.name ?? "Brand"} and ${deal.channel?.name ?? "creator"} · ${inr(deal.price_minor)}`}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Status map={DEAL_STATUS} status={deal.status} />
          {deal.auto_approved && <Badge color="slate">Approved automatically</Badge>}
        </div>
        {deal.status === "disputed" && (
          <Note>
            <p className="font-semibold text-navy">The brand disputes the delivery</p>
            <p>{deal.dispute_reason}</p>
          </Note>
        )}
        <section>
          <SectionHeading>Deal</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Brand" value={deal.brand?.name} />
            <Row
              label="Creator"
              value={
                deal.channel ? (
                  <a href={`${WEB_URL}/@${deal.channel.handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {deal.channel.name} (@{deal.channel.handle}) <ExternalLink size={13} />
                  </a>
                ) : "—"
              }
            />
            <Row label="Price" value={inr(deal.price_minor)} />
            <Row
              label="Delivered video"
              value={
                deal.video ? (
                  <a href={watchUrl(deal.video.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {deal.video.title} <ExternalLink size={13} />
                  </a>
                ) : "Not delivered"
              }
            />
            <Row label="Deliverables" value={deal.deliverables} wide />
          </dl>
        </section>
        <section>
          <SectionHeading>Timeline</SectionHeading>
          <dl className="grid grid-cols-2 gap-4">
            <Row label="Proposed" value={when(deal.created_at, true)} />
            <Row label="Funded" value={deal.funded_at ? when(deal.funded_at, true) : "Not yet"} />
            <Row label="Delivered" value={deal.delivered_at ? when(deal.delivered_at, true) : "Not yet"} />
            <Row label="Auto-approve on" value={deal.approve_by ? when(deal.approve_by, true) : "—"} />
            <Row label="Approved" value={deal.approved_at ? when(deal.approved_at, true) : "Not yet"} />
            {deal.resolution_note && <Row label="Resolution" value={deal.resolution_note} wide />}
          </dl>
        </section>
        {canAct && deal.status === "disputed" && (
          <section>
            <SectionHeading>Resolve the dispute</SectionHeading>
            <Field label="Decision note" required hint="At least three characters. Both sides see it.">
              <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="destructive" onClick={() => decide("refund")} disabled={resolve.isPending || note.trim().length < 3}>Refund the brand</Button>
              <Button onClick={() => decide("release")} disabled={resolve.isPending || note.trim().length < 3}>Release to the creator</Button>
            </div>
          </section>
        )}
      </div>
    </Drawer>
  )
}

export default function Sponsorships() {
  const [status, setStatus] = useState("")
  const [open, setOpen] = useState<Deal | null>(null)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [KEY, status],
    queryFn: async () => (await api.get<Deal[]>(`${VIDEO_ADMIN}/sponsorships/deals`, { params: status ? { status } : {} })).data,
  })
  const disputed = rows.filter((r) => r.status === "disputed").length

  return (
    <>
      <PageHeader title="Sponsorships" subtitle="Brand deals with creators; money is held until the brand approves" />
      {disputed > 0 && !status && (
        <Note className="mb-4">
          <p><b>{disputed}</b> deal{disputed === 1 ? " is" : "s are"} disputed and waiting for a decision.</p>
        </Note>
      )}
      <DataTable
        label="Sponsorship deals"
        loading={isLoading}
        rows={rows}
        rowKey={(r) => r.id}
        unitLabel="deals"
        emptyTitle="No deals"
        onRowClick={(r) => setOpen(r)}
        rowClassName={(r) => (r.status === "disputed" ? "bg-red-50/60" : undefined)}
        toolbarRight={<Select value={status} onChange={setStatus} options={FILTER} aria-label="Status" className="w-44" />}
        columns={[
          {
            key: "title",
            header: "Deal",
            render: (r) => (
              <span className="block min-w-0">
                <span className="block max-w-xs truncate font-medium text-navy">{r.title}</span>
                <span className="block truncate text-xs text-slate-500">{r.brand?.name ?? "Brand"} → {r.channel ? `@${r.channel.handle}` : "creator"}</span>
              </span>
            ),
          },
          { key: "price", header: "Price", align: "right", render: (r) => <span className="font-num">{inr(r.price_minor)}</span> },
          { key: "status", header: "Status", render: (r) => <Status map={DEAL_STATUS} status={r.status} /> },
          { key: "video", header: "Video", render: (r) => <span className="text-slate-600">{r.video?.title ?? "—"}</span> },
          { key: "created", header: "Started", render: (r) => <span className="text-slate-500">{relative(r.created_at)}</span> },
        ]}
      />
      {open && <DealDrawer key={open.id} deal={open} onClose={() => setOpen(null)} />}
    </>
  )
}
