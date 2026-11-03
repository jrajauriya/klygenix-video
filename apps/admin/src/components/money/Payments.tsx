import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Undo2 } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, DataTable, Field, Input, Modal, Select, Textarea, useConfirm } from "@klygenixvideo/ui"
import { fromMinor, toMinor } from "@klygenixvideo/client"
import { VIDEO_ADMIN, detail, useCanAct, when } from "../../lib/shared"
import type { AdminPayment, AdminRefund } from "../../lib/types"
import { PURPOSE_LABEL, inr, purposeLabel } from "./shared"

const FILTERS = [{ value: "", label: "Every purpose" }, ...Object.entries(PURPOSE_LABEL).map(([value, label]) => ({ value, label }))]

function newKey(): string {
  const c = globalThis.crypto
  return c && "randomUUID" in c ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function Payments({ purpose, onPurpose }: { purpose: string; onPurpose: (v: string) => void }) {
  const canAct = useCanAct("admin.money")
  const [refunding, setRefunding] = useState<AdminPayment | null>(null)
  const { data, isLoading } = useQuery<AdminPayment[]>({
    queryKey: ["admin-money-payments", purpose],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/payments`, { params: { purpose: purpose || undefined, limit: 200 } })).data,
  })

  return (
    <>
      <DataTable
        label="Payments"
        rows={data ?? []}
        rowKey={(p) => p.id}
        loading={isLoading}
        unitLabel="payments"
        emptyTitle="No payments yet"
        note="The 200 most recent verified payments."
        toolbarRight={<Select value={purpose} onChange={onPurpose} options={FILTERS} className="w-44" aria-label="Purpose" />}
        columns={[
          { key: "id", header: "#", sortKey: "id", render: (p) => <span className="font-num text-slate-500">{p.id}</span> },
          { key: "created", header: "Paid", sortKey: "created_at", render: (p) => when(p.created_at, true) },
          {
            key: "purpose",
            header: "For",
            render: (p) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{purposeLabel(p.purpose)}{p.plan_key ? ` · ${p.plan_key}` : ""}</p>
                {p.channel && <p className="text-xs text-slate-500">@{p.channel}</p>}
              </div>
            ),
          },
          { key: "buyer", header: "Buyer", render: (p) => <span className="block max-w-[14rem] truncate text-sm">{p.buyer ?? "—"}</span> },
          { key: "rail", header: "Rail", render: (p) => <Badge color={p.rail === "sandbox" ? "amber" : "slate"}>{p.rail}</Badge> },
          { key: "amount", header: "Amount", align: "right", sortKey: "amount_minor", render: (p) => <span className="font-num">{inr(p.amount_minor)}</span> },
          {
            key: "refunded",
            header: "Refunded",
            align: "right",
            sortKey: "refunded_minor",
            render: (p) => (p.refunded_minor ? <span className="font-num text-red-700">{inr(p.refunded_minor)}</span> : <span className="text-slate-500">—</span>),
          },
          {
            key: "act",
            header: "",
            srHeader: "Actions",
            render: (p) =>
              canAct && p.refundable_minor > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setRefunding(p)} aria-label={`Refund payment ${p.id}`}>
                  <Undo2 size={13} /> Refund
                </Button>
              ) : null,
          },
        ]}
      />
      {refunding && <RefundDialog key={refunding.id} payment={refunding} onClose={() => setRefunding(null)} />}
    </>
  )
}

function RefundDialog({ payment, onClose }: { payment: AdminPayment; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [mode, setMode] = useState<"full" | "partial">("full")
  const [amount, setAmount] = useState(fromMinor(payment.refundable_minor, payment.currency))
  const [reason, setReason] = useState("")
  const [key] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const cur = payment.currency || "INR"
  const partial = mode === "partial"
  const minor = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? toMinor(amount.trim(), cur) : null
  const amountError = partial && amount
    ? minor === null || minor <= 0 ? "Enter an amount, like 49 or 99.50." : minor > payment.refundable_minor ? `At most ${inr(payment.refundable_minor)}.` : undefined
    : undefined
  const refundMinor = partial ? minor ?? 0 : payment.refundable_minor
  const ready = reason.trim().length >= 3 && (!partial || (minor !== null && !amountError))

  async function submit() {
    const ok = await confirm({
      title: `Refund ${inr(refundMinor)}?`,
      message: `${inr(refundMinor)} goes back to ${payment.buyer ?? "the buyer"} and a credit note is issued. If the creator was already paid their share, it is recovered from their next payouts. This cannot be undone.`,
      confirmLabel: "Refund",
      variant: "destructive",
    })
    if (!ok) return
    setBusy(true)
    try {
      const { data } = await api.post<{ status: string; amount_minor: number }>(`${VIDEO_ADMIN}/payments/${payment.id}/refund`, {
        amount_minor: partial ? minor : undefined,
        reason: reason.trim(),
        idempotency_key: key,
      })
      toast.success(`Refunded ${inr(data.amount_minor)} (${data.status})`)
      qc.invalidateQueries({ queryKey: ["admin-money-payments"] })
      qc.invalidateQueries({ queryKey: ["admin-money-refunds"] })
      qc.invalidateQueries({ queryKey: ["admin-money-summary"] })
      qc.invalidateQueries({ queryKey: ["admin-money-transfers"] })
      qc.invalidateQueries({ queryKey: ["admin-money-creators"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "Could not refund the payment"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Refund payment #${payment.id}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!ready || busy}>
            <Undo2 size={14} /> {busy ? "Refunding…" : `Refund ${inr(refundMinor)}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div><dt className="text-xs text-slate-500">For</dt><dd className="font-medium text-slate-800">{purposeLabel(payment.purpose)}{payment.channel ? ` · @${payment.channel}` : ""}</dd></div>
          <div><dt className="text-xs text-slate-500">Buyer</dt><dd className="truncate text-slate-800">{payment.buyer ?? "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Paid</dt><dd className="font-num text-slate-800">{inr(payment.amount_minor)}</dd></div>
          <div><dt className="text-xs text-slate-500">Can still refund</dt><dd className="font-num font-semibold text-navy">{inr(payment.refundable_minor)}</dd></div>
        </dl>
        <fieldset className="space-y-2">
          <legend className="label">Amount</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="refund-mode" checked={!partial} onChange={() => setMode("full")} />
            Everything left: {inr(payment.refundable_minor)}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="refund-mode" checked={partial} onChange={() => setMode("partial")} />
            Part of it
          </label>
        </fieldset>
        {partial && (
          <Field label="Amount to refund (₹)" required error={amountError}>
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label="Reason" required hint="3 to 200 characters. Kept with the refund and on the credit note.">
          <Textarea rows={2} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function Refunds() {
  const { data, isLoading } = useQuery<AdminRefund[]>({
    queryKey: ["admin-money-refunds"],
    queryFn: async () => (await api.get(`${VIDEO_ADMIN}/refunds`, { params: { limit: 200 } })).data,
  })
  return (
    <DataTable
      label="Refunds"
      rows={data ?? []}
      rowKey={(r) => r.id}
      loading={isLoading}
      unitLabel="refunds"
      emptyTitle="No refunds yet"
      note="The 200 most recent."
      columns={[
        { key: "id", header: "#", sortKey: "id", render: (r) => <span className="font-num text-slate-500">{r.id}</span> },
        { key: "created", header: "When", sortKey: "created_at", render: (r) => when(r.created_at, true) },
        { key: "payment", header: "Payment", sortKey: "payment_id", render: (r) => <span className="font-num">#{r.payment_id}</span> },
        { key: "amount", header: "Amount", align: "right", sortKey: "amount_minor", render: (r) => <span className="font-num">{inr(r.amount_minor)}</span> },
        { key: "status", header: "Status", render: (r) => <Badge color={r.status === "processed" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge> },
        { key: "reason", header: "Reason", render: (r) => <span className="block max-w-[20rem] truncate" title={r.reason}>{r.reason}</span> },
        { key: "note", header: "Credit note", render: (r) => (r.credit_note_id ? <span className="font-num">#{r.credit_note_id}</span> : "—") },
      ]}
    />
  )
}
