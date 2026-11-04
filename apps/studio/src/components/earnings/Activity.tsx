import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@klygenixvideo/auth"
import { Badge, DataTable, Select, type DataTableColumn } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { when } from "../../lib/format"
import type { Sale, Transfer } from "../../lib/types"
import { useT, type T } from "../../i18n"
import { PURPOSES, TRANSFER_FILTERS, TRANSFER_KIND, TransferStatusPill, inr, purposeLabel } from "./shared"

const PURPOSE_FILTERS = [{ value: "", label: "Every kind" }, ...PURPOSES.map((p) => ({ value: p.key, label: p.label }))]

const money = (n: number) => <span className="font-num">{inr(n)}</span>

export const saleColumns = (t: T): DataTableColumn<Sale>[] => [
  { key: "paid_at", header: t("Paid"), sortKey: "paid_at", render: (s) => when(s.paid_at, true) },
  {
    key: "purpose",
    header: t("Kind"),
    render: (s) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-800">{purposeLabel(s.purpose)}</p>
        <p className="max-w-[14rem] truncate text-xs text-slate-500">{s.reference}</p>
      </div>
    ),
  },
  { key: "gross", header: t("Paid by viewer"), align: "right", sortKey: "gross_minor", render: (s) => money(s.gross_minor) },
  {
    key: "commission",
    header: t("Commission + GST"),
    align: "right",
    render: (s) => (
      <span className="font-num" title={t("{pct}% commission", { pct: s.commission_bps / 100 })}>{inr(s.commission_minor + s.commission_tax_minor)}</span>
    ),
  },
  { key: "withheld", header: t("TCS + TDS"), align: "right", render: (s) => money(s.tcs_minor + s.tds_minor) },
  {
    key: "net",
    header: t("Your share"),
    align: "right",
    sortKey: "net_minor",
    render: (s) => (
      <span className="inline-flex items-center gap-1.5">
        {s.refunded_minor > 0 && <Badge color="amber">{t("Refunded {amount}", { amount: inr(s.refunded_minor) })}</Badge>}
        <span className="font-num font-semibold text-navy">{inr(s.net_minor)}</span>
      </span>
    ),
  },
]

export function Activity() {
  const t = useT()
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
    { key: "id", header: "#", render: (x) => <span className="font-num text-slate-500">{x.id}</span> },
    { key: "kind", header: t("Kind"), render: (x) => (TRANSFER_KIND[x.kind] ? t(TRANSFER_KIND[x.kind]) : x.kind) },
    { key: "status", header: t("Status"), render: (x) => <TransferStatusPill status={x.status} /> },
    { key: "amount", header: t("Amount"), align: "right", sortKey: "amount_minor", render: (x) => money(x.amount_minor) },
    { key: "reversed", header: t("Reversed"), align: "right", render: (x) => (x.reversed_minor ? money(x.reversed_minor) : <span className="text-slate-500">—</span>) },
    {
      key: "when",
      header: t("Release"),
      render: (x) =>
        x.released_at ? t("Released {date}", { date: when(x.released_at) }) : x.hold_until && x.status === "held" ? t("Due {date}", { date: when(x.hold_until) }) : "—",
    },
    {
      key: "note",
      header: t("Note"),
      render: (x) => (
        <span className="block max-w-[16rem] truncate text-xs text-slate-500" title={x.error ?? x.note ?? undefined}>
          {x.error ? <span className="text-red-700">{x.error}</span> : x.note ?? ""}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Sales")}</h2>
      <DataTable
        label={t("Sales")}
        rows={sales.data ?? []}
        columns={saleColumns(t)}
        rowKey={(s) => s.id}
        loading={sales.isLoading}
        unitLabel={t("sales")}
        initialSort={{ key: "paid_at", dir: "desc" }}
        toolbarRight={<Select value={purpose} onChange={setPurpose} options={PURPOSE_FILTERS.map((o) => ({ ...o, label: t(o.label) }))} className="w-44" aria-label={t("Kind")} />}
        emptyTitle={t("No sales yet")}
        emptyDescription={t("Tips, boosts, memberships and paid videos show here as viewers pay.")}
        note={t("Your 200 most recent sales. Statements have every sale for a month.")}
      />
      </section>
      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Transfers to your bank")}</h2>
      <DataTable
        label={t("Transfers")}
        rows={transfers.data ?? []}
        columns={transferColumns}
        rowKey={(x) => x.id}
        loading={transfers.isLoading}
        unitLabel={t("transfers")}
        toolbarRight={<Select value={status} onChange={setStatus} options={TRANSFER_FILTERS.map((o) => ({ ...o, label: t(o.label) }))} className="w-44" aria-label={t("Status")} />}
        emptyTitle={t("No transfers yet")}
        emptyDescription={t("Each sale makes a transfer for your share and one for the reserve. They are released to your bank when the hold ends.")}
      />
      </section>
    </div>
  )
}
