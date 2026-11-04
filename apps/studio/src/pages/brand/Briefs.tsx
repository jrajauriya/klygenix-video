import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, ExternalLink, Plus, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Drawer, Field, Input, Modal, PageHeader, Spinner, Textarea, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { channelUrl, compact, detail, languageName, when } from "../../lib/format"
import { DEAL_MIN, deliverableLabel, useBrand, type Application, type Brief, type Deal } from "../../lib/market"
import { ApplicationStatusPill, NeedsBrand } from "../../components/brand/shared"
import { BriefForm } from "../../components/brand/BriefForm"
import { inr, parseRupees } from "../../components/earnings/shared"
import { ChannelAvatar } from "../../components/ChannelAvatar"

const budget = (b: Brief) => `${inr(b.budget_min_minor)} to ${inr(b.budget_max_minor)}`

function AcceptModal({ application, brief, onClose, onDone }: { application: Application; brief: Brief; onClose: () => void; onDone: (d: Deal) => void }) {
  const [deliverables, setDeliverables] = useState(`${deliverableLabel(brief.deliverable)}: `)
  const [price, setPrice] = useState(String(application.quote_minor / 100))
  const [busy, setBusy] = useState(false)
  const minor = parseRupees(price)
  const priceError = minor === null || minor < DEAL_MIN ? `At least ${inr(DEAL_MIN)}.` : undefined
  const tooShort = deliverables.trim().length < 10

  async function accept() {
    setBusy(true)
    try {
      const { data } = await api.post<Deal>(`${STUDIO}/sponsorships/applications/${application.id}/accept`, {
        deliverables: deliverables.trim(),
        price_minor: minor !== application.quote_minor ? minor : undefined,
      })
      toast.success("Deal proposed. Fund it to let the creator start.")
      onDone(data)
    } catch (err) {
      toast.error(detail(err, "The application could not be accepted"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Accept ${application.channel?.name ?? "this creator"}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={accept} disabled={busy || tooShort || Boolean(priceError)}>{busy ? "Accepting…" : "Propose the deal"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="What the creator delivers" required error={deliverables && tooShort ? "At least 10 characters." : undefined}
          hint="Be specific: length, mentions, links, posting window. This is what you approve against.">
          <Textarea rows={4} value={deliverables} maxLength={3000} onChange={(e) => setDeliverables(e.target.value)} />
        </Field>
        <Field label="Price (₹)" required error={priceError} hint={`They quoted ${inr(application.quote_minor)}.`}>
          <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} className="max-w-[12rem]" />
        </Field>
        <p className="text-xs text-slate-600">Next you fund the deal. The money is held until you approve the delivered video.</p>
      </div>
    </Modal>
  )
}

function Applications({ brief, onClose }: { brief: Brief; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.brand", "full")
  const [accepting, setAccepting] = useState<Application | null>(null)
  const { data: rows, isLoading } = useQuery({
    queryKey: ["studio-brief-applications", brief.id],
    queryFn: async () => (await api.get<Application[]>(`${STUDIO}/sponsorships/briefs/${brief.id}/applications`)).data,
  })

  async function decline(a: Application) {
    const ok = await confirm({ title: `Decline ${a.channel?.name ?? "this application"}?`, confirmLabel: "Decline", variant: "destructive" })
    if (!ok) return
    try {
      await api.post(`${STUDIO}/sponsorships/applications/${a.id}/decline`)
      toast.success("Declined")
      qc.invalidateQueries({ queryKey: ["studio-brief-applications", brief.id] })
    } catch (err) {
      toast.error(detail(err, "Could not decline"))
    }
  }

  return (
    <Drawer open onClose={onClose} width="lg" title={brief.title} subtitle={`${deliverableLabel(brief.deliverable)} · ${budget(brief)}`}>
      {isLoading ? (
        <Spinner />
      ) : !rows?.length ? (
        <p className="text-sm text-slate-500">No applications yet. Creators who match the brief see it under Sponsorships.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                {a.channel && <ChannelAvatar channel={a.channel} size={36} />}
                <div className="min-w-0 flex-1">
                  {a.channel ? (
                    <a href={channelUrl(a.channel.handle)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-navy hover:text-brand">
                      {a.channel.name} <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : <span className="text-sm font-semibold text-navy">A channel</span>}
                  <p className="text-xs text-slate-500">{a.channel ? `@${a.channel.handle} · ${compact(a.channel.followers)} followers · ` : ""}applied {when(a.created_at)}</p>
                </div>
                <span className="font-num text-sm font-bold text-navy">{inr(a.quote_minor)}</span>
                <ApplicationStatusPill status={a.status} />
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{a.pitch}</p>
              {canEdit && a.status === "applied" && brief.status === "open" && (
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => decline(a)}><X size={14} /> Decline</Button>
                  <Button size="sm" onClick={() => setAccepting(a)}><Check size={14} /> Accept</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {accepting && (
        <AcceptModal
          application={accepting}
          brief={brief}
          onClose={() => setAccepting(null)}
          onDone={(d) => {
            qc.invalidateQueries({ queryKey: ["studio-deals"] })
            qc.invalidateQueries({ queryKey: ["studio-brief-applications", brief.id] })
            navigate(`/sponsorships/deals/${d.id}`)
          }}
        />
      )}
    </Drawer>
  )
}

export default function Briefs() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canEdit = useHasPermission("video.brand", "full")
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Brief | null>(null)
  const { data: brand, isLoading: brandLoading } = useBrand()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["studio-my-briefs"],
    queryFn: async () => (await api.get<Brief[]>(`${STUDIO}/sponsorships/my-briefs`)).data,
  })

  async function close(b: Brief) {
    const ok = await confirm({
      title: `Close "${b.title}"?`,
      message: "Creators can no longer apply. Deals you already proposed carry on.",
      confirmLabel: "Close brief",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await api.post(`${STUDIO}/sponsorships/briefs/${b.id}/close`)
      toast.success("Brief closed")
      qc.invalidateQueries({ queryKey: ["studio-my-briefs"] })
    } catch (err) {
      toast.error(detail(err, "Could not close the brief"))
    }
  }

  if (brandLoading) return <Spinner />

  return (
    <div className="pb-8">
      <PageHeader
        title="Sponsorship briefs"
        subtitle="Tell creators what you want made. Pick from the ones who apply."
        actions={brand && canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> New brief</Button> : undefined}
      />
      {!brand ? (
        <NeedsBrand what="Sponsorship briefs" />
      ) : (
        <DataTable
          label="Sponsorship briefs"
          loading={isLoading}
          rows={rows}
          rowKey={(r) => r.id}
          unitLabel="briefs"
          emptyTitle="No briefs yet"
          emptyDescription="Post a brief and creators who match can apply."
          onRowClick={(r) => setOpen(r)}
          columns={[
            {
              key: "title",
              header: "Brief",
              render: (r) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium text-navy">{r.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {deliverableLabel(r.deliverable)}{r.languages.length ? ` · ${r.languages.map(languageName).join(", ")}` : ""}
                  </span>
                </span>
              ),
            },
            { key: "budget", header: "Budget", render: (r) => <span className="font-num">{budget(r)}</span> },
            { key: "applicants", header: "Applicants", align: "right", render: (r) => <span className="font-num font-semibold">{r.applicants ?? 0}</span> },
            { key: "deadline", header: "Apply by", render: (r) => (r.deadline ? when(r.deadline) : "No deadline") },
            { key: "status", header: "Status", render: (r) => <Badge color={r.status === "open" ? "green" : "slate"}>{r.status === "open" ? "Open" : "Closed"}</Badge> },
            {
              key: "actions",
              header: "",
              srHeader: "Actions",
              align: "right",
              render: (r) =>
                canEdit && r.status === "open" ? (
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); close(r) }}>Close</Button>
                ) : null,
            },
          ]}
        />
      )}
      {creating && (
        <BriefForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            qc.invalidateQueries({ queryKey: ["studio-my-briefs"] })
          }}
        />
      )}
      {open && <Applications brief={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
