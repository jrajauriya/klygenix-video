import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import {
  Badge, Button, Card, DataTable, Drawer, DrawerFooter, Field, Input, Select, Textarea,
} from "@klygenixvideo/ui"
import { formatBusinessDate, formatMoney, toMinor } from "@klygenixvideo/client"

interface Payment {
  id: number
  amount_minor: number
  currency: string
  payment_date: string
  payment_type: string
  period_start: string | null
  period_end: string | null
  method: string | null
  reference: string | null
  notes: string | null
}

const TYPES = [
  { value: "licence", label: "Licence" },
  { value: "renewal", label: "Renewal" },
  { value: "setup", label: "Setup" },
  { value: "support", label: "Support" },
  { value: "other", label: "Other" },
]

const METHODS = [
  { value: "", label: "Not recorded" },
  { value: "neft", label: "NEFT / RTGS" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
]

const BLANK = {
  amount: "",
  payment_date: new Date().toISOString().slice(0, 10),
  payment_type: "licence",
  period_start: "",
  period_end: "",
  method: "",
  reference: "",
  notes: "",
}

export function TenantPayments({ tenantId }: { tenantId: number }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const currency = "INR"

  const { data: payments = [], isLoading } = useQuery<Payment[]>({
    queryKey: ["admin-tenant-payments", tenantId],
    queryFn: async () => (await api.get(`/api/admin/tenants/${tenantId}/payments`)).data,
  })

  const record = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/admin/tenants/${tenantId}/payments`, {
          amount_minor: toMinor(form.amount, currency),
          currency,
          payment_date: form.payment_date,
          payment_type: form.payment_type,
          period_start: form.period_start || null,
          period_end: form.period_end || null,
          method: form.method || null,
          reference: form.reference || null,
          notes: form.notes || null,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tenant-payments", tenantId] })
      qc.invalidateQueries({ queryKey: ["admin-stats"] })
      toast.success("Payment recorded")
      setForm(BLANK)
      setOpen(false)
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "That could not be recorded."),
  })

  const collected = payments.reduce((sum, p) => sum + p.amount_minor, 0)

  return (
    <>
      <Card className="mb-4 flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Collected</p>
          <p className="font-num text-xl font-semibold text-slate-900">
            {formatMoney(collected, currency)}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Record a payment
        </Button>
      </Card>

      <DataTable<Payment>
        loading={isLoading}
        rows={payments}
        rowKey={(p) => p.id}
        unitLabel="payments"
        emptyTitle="Nothing recorded"
        emptyDescription="What this customer has paid for their licence is entered here."
        columns={[
          {
            key: "payment_date",
            header: "Paid on",
            sortValue: (p) => p.payment_date,
            render: (p) => formatBusinessDate(p.payment_date),
          },
          {
            key: "payment_type",
            header: "For",
            render: (p) => <Badge color="slate">{p.payment_type}</Badge>,
          },
          {
            key: "period",
            header: "Period",
            render: (p) =>
              p.period_start && p.period_end
                ? `${formatBusinessDate(p.period_start)} — ${formatBusinessDate(p.period_end)}`
                : "—",
          },
          {
            key: "method",
            header: "How",
            render: (p) => p.method ?? "—",
          },
          {
            key: "reference",
            header: "Reference",
            render: (p) => p.reference ?? "—",
          },
          {
            key: "amount",
            header: "Amount",
            align: "right",
            className: "font-num font-semibold",
            sortValue: (p) => p.amount_minor,
            render: (p) => formatMoney(p.amount_minor, p.currency),
          },
        ]}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Record a payment"
        subtitle="Licence money received from this customer"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Amount (${currency})`} required>
            <Input
              value={form.amount}
              inputMode="decimal"
              placeholder="25000.00"
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Paid on" required>
            <Input
              type="date"
              value={form.payment_date}
              onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
            />
          </Field>
          <Field label="For">
            <Select
              value={form.payment_type}
              onChange={(v) => setForm({ ...form, payment_type: v })}
              options={TYPES}
            />
          </Field>
          <Field label="How">
            <Select
              value={form.method}
              onChange={(v) => setForm({ ...form, method: v })}
              options={METHODS}
            />
          </Field>
          <Field label="Period from">
            <Input
              type="date"
              value={form.period_start}
              onChange={(e) => setForm({ ...form, period_start: e.target.value })}
            />
          </Field>
          <Field label="Period to">
            <Input
              type="date"
              value={form.period_end}
              onChange={(e) => setForm({ ...form, period_end: e.target.value })}
            />
          </Field>
          <Field label="Reference" className="col-span-2" hint="Their UTR, cheque number">
            <Input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
        <DrawerFooter
          onCancel={() => setOpen(false)}
          save={{
            label: "Record",
            pending: record.isPending,
            disabled: !form.amount || toMinor(form.amount, currency) <= 0,
            onClick: () => record.mutate(),
          }}
        />
      </Drawer>
    </>
  )
}
