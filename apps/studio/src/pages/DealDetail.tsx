import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { BadgeCheck, CheckCircle2, Circle, ExternalLink, Flag, Send, Wallet, X } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, EmptyState, Field, Modal, PageHeader, Select, Spinner, Textarea, useConfirm } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../lib/hooks"
import { channelUrl, clock, detail, watchUrl, when } from "../lib/format"
import { newKey, usePublishedVideos, type Deal, type PayableCheckout } from "../lib/market"
import { DealStatusPill } from "../components/brand/shared"
import { PayModal } from "../components/PayModal"
import { inr } from "../components/earnings/shared"

function Deliver({ deal, onClose, onDone }: { deal: Deal; onClose: () => void; onDone: (d: Deal) => void }) {
  const { data: videos, isLoading } = usePublishedVideos()
  const [video, setVideo] = useState("")
  const [busy, setBusy] = useState(false)
  const options = (videos ?? []).filter((v) => v.source !== "embed").map((v) => ({ value: v.public_id, label: v.title, hint: clock(v.duration_ms) }))

  async function send() {
    setBusy(true)
    try {
      const { data } = await api.post<Deal>(`${STUDIO}/sponsorships/deals/${deal.id}/deliver`, { video_id: video })
      toast.success("Delivered. The brand has been told.")
      onDone(data)
    } catch (err) {
      toast.error(detail(err, "The video could not be delivered"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Deliver the sponsored video"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={send} disabled={busy || !video}><Send size={14} /> {busy ? "Delivering…" : "Deliver"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Your video" required hint="One of your own published videos that meets the deliverables.">
          <Select value={video} onChange={setVideo} options={options} placeholder={isLoading ? "Loading your videos…" : options.length ? "Choose a video" : "No published videos yet"} />
        </Field>
        <p className="rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2.5 text-sm text-slate-700">
          The video will carry a <b>Paid partnership with {deal.brand?.name ?? "the brand"}</b> label for viewers, as the law requires.
          The label stays on the video even after the deal is paid.
        </p>
        <p className="text-xs text-slate-600">
          The brand then has a few days to approve or raise a dispute. If they do nothing, the deal is approved automatically and your share is released.
        </p>
      </div>
    </Modal>
  )
}

function Dispute({ deal, onClose, onDone }: { deal: Deal; onClose: () => void; onDone: (d: Deal) => void }) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    try {
      const { data } = await api.post<Deal>(`${STUDIO}/sponsorships/deals/${deal.id}/dispute`, { reason: reason.trim() })
      toast.success("Dispute raised. Our team will look at it and decide.")
      onDone(data)
    } catch (err) {
      toast.error(detail(err, "The dispute could not be raised"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Raise a dispute"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={send} disabled={busy || reason.trim().length < 10}>{busy ? "Sending…" : "Raise dispute"}</Button>
        </div>
      }
    >
      <Field label="What is wrong with the delivery?" required hint="At least 10 characters. Point to the deliverables that were not met.">
        <Textarea rows={5} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="mt-3 text-xs text-slate-600">The money stays held while Klygenix reviews it. We either release it to the creator or refund it to you.</p>
    </Modal>
  )
}

function Step({ done, label, at }: { done: boolean; label: string; at?: string | null }) {
  return (
    <li className="flex items-start gap-2.5">
      {done ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-700" aria-hidden="true" /> : <Circle size={17} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />}
      <span className="min-w-0">
        <span className={done ? "block text-sm font-medium text-slate-800" : "block text-sm text-slate-500"}>{label}</span>
        {at && <span className="block text-xs text-slate-500">{when(at, true)}</span>}
      </span>
    </li>
  )
}

export default function DealDetail() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canBrand = useHasPermission("video.brand", "full")
  const canCreator = useHasPermission("video.sponsorships", "full")
  const [modal, setModal] = useState<"deliver" | "dispute" | null>(null)
  const [checkout, setCheckout] = useState<PayableCheckout | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fundKey = useMemo(() => newKey(`deal-${id}`), [id])
  const { data: deal, isLoading, isError } = useQuery({
    queryKey: ["studio-deal", id],
    queryFn: async () => (await api.get<Deal>(`${STUDIO}/sponsorships/deals/${id}`)).data,
    retry: false,
  })

  if (isLoading) return <Spinner />
  if (isError || !deal) return <EmptyState title="Deal not found" hint="It may belong to another account." />

  const brand = deal.role === "brand"
  const update = (d: Deal) => {
    qc.setQueryData(["studio-deal", id], { ...d, role: deal.role })
    qc.invalidateQueries({ queryKey: ["studio-deals"] })
    setModal(null)
  }

  async function fund() {
    setBusy("fund")
    try {
      const { data } = await api.post<PayableCheckout>(`${STUDIO}/sponsorships/deals/${deal!.id}/fund`, { idempotency_key: fundKey })
      setCheckout(data)
    } catch (err) {
      toast.error(detail(err, "The deal could not be funded"))
    } finally {
      setBusy(null)
    }
  }

  async function act(action: "approve" | "cancel") {
    const ok = await confirm(
      action === "approve"
        ? { title: "Approve the delivery?", message: `${inr(deal!.price_minor)} is released to the creator, less Klygenix's commission. This cannot be undone.`, confirmLabel: "Approve and pay" }
        : {
            title: "Cancel this deal?",
            message: deal!.status === "funded" ? `Your ${inr(deal!.price_minor)} is refunded.` : "The creator is told the deal is off.",
            confirmLabel: "Cancel deal",
            variant: "destructive",
          },
    )
    if (!ok) return
    setBusy(action)
    try {
      const { data } = await api.post<Deal>(`${STUDIO}/sponsorships/deals/${deal!.id}/${action}`)
      toast.success(action === "approve" ? "Approved. The creator is being paid." : "Deal cancelled")
      update(data)
    } catch (err) {
      toast.error(detail(err, "That did not work"))
    } finally {
      setBusy(null)
    }
  }

  const other = brand
    ? deal.channel ? (
        <a href={channelUrl(deal.channel.handle)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
          {deal.channel.name} (@{deal.channel.handle}) <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : "A channel"
    : deal.brand?.name ?? "A brand"

  return (
    <div className="pb-8">
      <PageHeader
        title={deal.title}
        subtitle={brand ? "You are the brand on this deal" : "You are the creator on this deal"}
        onBack={() => navigate(brand ? "/brand/deals" : "/sponsorships?tab=deals")}
        actions={
          <>
            <DealStatusPill status={deal.status} />
            {brand && canBrand && deal.status === "proposed" && (
              <Button size="sm" onClick={fund} disabled={busy !== null}><Wallet size={14} /> {busy === "fund" ? "Preparing…" : `Fund ${inr(deal.price_minor)}`}</Button>
            )}
            {brand && canBrand && deal.status === "delivered" && (
              <>
                <Button size="sm" onClick={() => act("approve")} disabled={busy !== null}><BadgeCheck size={14} /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setModal("dispute")} disabled={busy !== null}><Flag size={14} /> Dispute</Button>
              </>
            )}
            {brand && canBrand && (deal.status === "proposed" || deal.status === "funded") && (
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => act("cancel")} disabled={busy !== null}><X size={14} /> Cancel deal</Button>
            )}
            {!brand && canCreator && deal.status === "funded" && (
              <Button size="sm" onClick={() => setModal("deliver")}><Send size={14} /> Deliver the video</Button>
            )}
          </>
        }
      />

      {deal.status === "proposed" && (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          {brand ? "Fund the deal so the creator can start. The money is held, not paid out, until you approve the video." : "Waiting for the brand to fund the deal. Do not start work until it is funded."}
        </p>
      )}
      {deal.status === "funded" && !brand && (
        <p role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
          The brand has funded the deal and the money is held for you. Make the video, publish it, then deliver it here.
        </p>
      )}
      {deal.status === "delivered" && (
        <p role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-900">
          {brand ? "Check the video against the deliverables, then approve or dispute it" : "Waiting for the brand to approve"}
          {deal.approve_by ? `. It is approved automatically on ${when(deal.approve_by, true)}.` : "."}
        </p>
      )}
      {deal.status === "disputed" && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          Disputed{deal.dispute_reason ? `: ${deal.dispute_reason}` : "."} Klygenix is reviewing it and will release or refund the money.
        </p>
      )}
      {deal.resolution_note && deal.status !== "disputed" && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">Outcome: {deal.resolution_note}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{brand ? "Creator" : "Brand"}</dt>
              <dd className="text-sm text-slate-800">{other}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Price</dt>
              <dd className="font-num text-sm font-bold text-navy">{inr(deal.price_minor)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Deliverables</dt>
              <dd className="whitespace-pre-line text-sm text-slate-800">{deal.deliverables}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Delivered video</dt>
              <dd className="text-sm text-slate-800">
                {deal.video ? (
                  <a href={watchUrl(deal.video.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    {deal.video.title} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : "Not delivered yet"}
              </dd>
            </div>
          </dl>
          {!brand && (
            <p className="border-t border-slate-100 pt-3 text-xs text-slate-600">
              The delivered video carries a "Paid partnership with {deal.brand?.name ?? "the brand"}" label. Your share, less Klygenix's commission, goes to your payout account once the deal is approved.
            </p>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h2 className="mb-3 text-sm font-bold text-navy">Progress</h2>
          <ol className="space-y-3">
            <Step done label="Deal proposed" at={deal.created_at} />
            <Step done={Boolean(deal.funded_at)} label="Funded by the brand" at={deal.funded_at} />
            <Step done={Boolean(deal.delivered_at)} label="Video delivered" at={deal.delivered_at} />
            <Step
              done={Boolean(deal.approved_at)}
              label={deal.auto_approved ? "Approved automatically" : "Approved"}
              at={deal.approved_at ?? (deal.status === "delivered" ? deal.approve_by : null)}
            />
          </ol>
        </Card>
      </div>

      {modal === "deliver" && <Deliver deal={deal} onClose={() => setModal(null)} onDone={update} />}
      {modal === "dispute" && <Dispute deal={deal} onClose={() => setModal(null)} onDone={update} />}
      {checkout && (
        <PayModal
          checkout={checkout}
          title={`Fund "${deal.title}"`}
          description="Sponsorship"
          onClose={() => setCheckout(null)}
          onPaid={() => {
            setCheckout(null)
            toast.success("Funded. The creator can start.")
            qc.invalidateQueries({ queryKey: ["studio-deal", id] })
            qc.invalidateQueries({ queryKey: ["studio-deals"] })
          }}
        >
          The money is held by Klygenix until you approve the delivered video. If you cancel before delivery, it is refunded.
        </PayModal>
      )}
    </div>
  )
}
