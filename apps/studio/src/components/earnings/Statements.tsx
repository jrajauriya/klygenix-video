import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileDown } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, DataTable, Field, Input, downloadFile } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { when } from "../../lib/format"
import type { CommissionInvoice, Statement } from "../../lib/types"
import { saleColumns } from "./Activity"
import { inr, purposeLabel } from "./shared"
import { useT } from "../../i18n"

export function Statements({ month: current }: { month: string }) {
  const t = useT()
  const [month, setMonth] = useState(current)
  const valid = /^\d{4}-\d{2}$/.test(month)
  const { data, isLoading } = useQuery({
    queryKey: ["studio-earnings-statement", month],
    queryFn: async () => (await api.get<Statement>(`${STUDIO}/earnings/statement`, { params: { month } })).data,
    enabled: valid,
  })
  const invoices = useQuery({
    queryKey: ["studio-commission-invoices"],
    queryFn: async () => (await api.get<CommissionInvoice[]>(`${STUDIO}/earnings/commission-invoices`)).data,
  })
  const totals = data?.totals
  const by = Object.entries(data?.by_purpose ?? {})

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-navy">{t("Monthly statement")}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{t("Every sale in the month, what was deducted, and what was released to your bank.")}</p>
          </div>
          <div className="flex items-end gap-2">
            <Field label={t("Month")}>
              <Input type="month" value={month} max={current} onChange={(e) => setMonth(e.target.value)} className="w-44" />
            </Field>
            <Button variant="outline" disabled={!valid}
              onClick={() => downloadFile(`${STUDIO}/earnings/statement?month=${month}&format=csv`, `earnings-${month}.csv`)}>
              <FileDown size={14} /> CSV
            </Button>
          </div>
        </div>
        {totals && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["Sales", totals.gross_minor],
              ["Commission + GST", totals.commission_minor + totals.commission_tax_minor],
              ["TCS + TDS", totals.tcs_minor + totals.tds_minor],
              ["Refunded", totals.refunded_minor],
              ["Your share", totals.net_minor],
              ["Released to bank", data?.released_minor ?? 0],
            ] as [string, number][]).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-xs text-slate-500">{t(k)}</dt>
                <dd className="font-num text-sm font-bold text-navy">{inr(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {by.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {by.map(([k, v]) => `${purposeLabel(k)} ${inr(v)}`).join(" · ")}
          </p>
        )}
      </Card>

      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Sales in the month")}</h2>
      <DataTable
        label={t("Sales in {month}", { month })}
        rows={data?.sales ?? []}
        columns={saleColumns(t)}
        rowKey={(s) => s.id}
        loading={isLoading && valid}
        unitLabel={t("sales")}
        emptyTitle={t("No sales in this month")}
      />
      </section>

      <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Commission invoices")}</h2>
      <DataTable
        label={t("Commission invoices")}
        rows={invoices.data ?? []}
        rowKey={(i) => i.id}
        loading={invoices.isLoading}
        unitLabel={t("invoices")}
        emptyTitle={t("No commission invoices yet")}
        emptyDescription={t("Klygenix Play issues one tax invoice a month for the commission it kept. Use it to claim the GST as input credit.")}
        columns={[
          { key: "number", header: t("Number"), render: (i) => <span className="font-num font-semibold text-slate-800">{i.number}</span> },
          { key: "date", header: t("Date"), sortKey: "date", render: (i) => when(i.date) },
          { key: "month", header: t("For"), render: (i) => i.month ?? "—" },
          { key: "taxable", header: t("Commission"), align: "right", render: (i) => <span className="font-num">{inr(i.taxable_minor)}</span> },
          { key: "tax", header: "GST", align: "right", render: (i) => <span className="font-num">{inr(i.tax_minor)}</span> },
          { key: "total", header: t("Total"), align: "right", render: (i) => <span className="font-num font-semibold">{inr(i.total_minor)}</span> },
          {
            key: "pdf",
            header: "",
            srHeader: t("Download"),
            render: (i) => (
              <Button size="sm" variant="outline" aria-label={t("PDF of {number}", { number: i.number })}
                onClick={() => downloadFile(`${STUDIO}/earnings/commission-invoices/${i.id}.pdf`, `${i.number.replace(/[^\w-]+/g, "_")}.pdf`)}>
                <FileDown size={13} /> PDF
              </Button>
            ),
          },
        ]}
      />
      </section>
    </div>
  )
}
