import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { Badge, DataTable, Select, type DataTableColumn } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { when } from "../../lib/format"
import type { Sale, Transfer } from "../../lib/types"
import { PURPOSES, TRANSFER_FILTERS, TRANSFER_KIND, TransferStatusPill, inr, purposeLabel } from "./shared"

const PURPOSE_FILTERS = [{ value: "", label: "Every kind" }, ...PURPOSES.map((p) => ({ value: p.key, label: p.label }))]

const money = (n: number) => <span className="font-num">{inr(n)}</span>

export const SALE_COLUMNS: DataTableColumn<Sale>[] = [
  { key: "paid_at", header: "Paid", sortKey: "paid_at", render: (s) => when(s.paid_at, true) },
  {
    key: "purpose",
    header: "Kind",
    render: (s) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-800">{purposeLabel(s.purpose)}</p>
        <p className="max-w-[14rem] truncate text-xs text-slate-500">{s.reference}</p>
      </div>
    ),
  },
  { key: "gross", header: "Paid by viewer", align: "right", sortKey: "gross_minor", render: (s) => money(s.gross_minor) },
  {
    key: "commission",
    header: "Commission + GST",
    align: "right",
    render: (s) => (
      <span className="font-num" title={`${s.commission_bps / 100}% commission`}>{inr(s.commission_minor + s.commission_tax_minor)}</span>
    ),
  },
  { key: "withheld", header: "TCS + TDS", align: "right", render: (s) => money(s.tcs_minor + s.tds_minor) },
  {
    key: "net",
    header: "Your share",
    align: "right",
    sortKey: "net_minor",
    render: (s) => (
      <span className="inline-flex items-center gap-1.5">
        {s.refunded_minor > 0 && <Badge color="amber">Refunded {inr(s.refunded_minor)}</Badge>}
        <span className="font-num font-semibold text-navy">{inr(s.net_minor)}</span>
      </span>
    ),
  },
]

export function Activity() {
  const [purpose, setPurpose] = useState("")
  const [status, setStatus] = useState("")
  const sales = useQuery({
    queryKey: ["studio-earnings-sales", purpose],
    queryFn: async () => (await api.get<Sale[]>(`${STUDIO}/earnings/sales`, { params: { purpose: purpose || undefined, limit: 200 } })).data,
  })
  const transfers = useQuery({
    queryKey: ["studio-earnings-transfers", status],
    queryFn: async () => (await api.get<Transfer[]>(`${STUDIO}/earnings/transfers`, { params: { status: status || undefined, limit: 200 } })).data,
  })

  const transferColumns: DataTableColumn<Transfer>[] = [
    { key: "id", header: "#", render: (t) => <span className="font-num text-slate-500">{t.id}</span> },
    { key: "kind", header: "Kind", render: (t) => TRANSFER_KIND[t.kind] ?? t.kind },
    { key: "status", header: "Status", render: (t) => <TransferStatusPill status={t.status} /> },
    { key: "amount", header: "Amount", align: "right", sortKey: "amount_minor", render: (t) => money(t.amount_minor) },
    { key: "reversed", header: "Reversed", align: "right", render: (t) => (t.reversed_minor ? money(t.reversed_minor) : <span className="text-slate-500">—</span>) },
    {
      key: "when",
      header: "Release",
      render: (t) =>
        t.released_at ? `Released ${when(t.released_at)}` : t.hold_until && t.status === "held" ? `Due ${when(t.hold_until)}` : "—",
    },
    {
      key: "note",
      header: "Note",
      render: (t) => (
        <span className="block max-w-[16rem] truncate text-xs text-slate-500" title={t.error ?? t.note ?? undefined}>
          {t.error ? <span className="text-red-700">{t.error}</span> : t.note ?? ""}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sales</h2>
      <DataTable
        label="Sales"
        rows={sales.data ?? []}
        columns={SALE_COLUMNS}
        rowKey={(s) => s.id}
        loading={sales.isLoading}
        unitLabel="sales"
        initialSort={{ key: "paid_at", dir: "desc" }}
        toolbarRight={<Select value={purpose} onChange={setPurpose} options={PURPOSE_FILTERS} className="w-44" aria-label="Kind" />}
        emptyTitle="No sales yet"
        emptyDescription="Tips, boosts, memberships and paid videos show here as viewers pay."
        note="Your 200 most recent sales. Statements have every sale for a month."
      />
      </section>
      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transfers to your bank</h2>
      <DataTable
        label="Transfers"
        rows={transfers.data ?? []}
        columns={transferColumns}
        rowKey={(t) => t.id}
        loading={transfers.isLoading}
        unitLabel="transfers"
        toolbarRight={<Select value={status} onChange={setStatus} options={TRANSFER_FILTERS} className="w-44" aria-label="Status" />}
        emptyTitle="No transfers yet"
        emptyDescription="Each sale makes a transfer for your share and one for the reserve. They are released to your bank when the hold ends."
      />
      </section>
    </div>
  )
}
