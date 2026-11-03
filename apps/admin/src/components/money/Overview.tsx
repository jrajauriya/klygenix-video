import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, ArrowDownLeft, Clock, FileDown, FileText, Landmark, Receipt, ShieldCheck, Truck, Wallet } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, SectionHeading, StatCard, downloadFile, useConfirm } from "@klygenixvideo/ui"
import { Status, detail, num, useCanAct } from "../../lib/shared"
import type { MoneySummary } from "../../lib/types"
import { ACCOUNT_STATUS, MONEY, inr, thisMonth } from "./shared"

export function Overview() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const canAct = useCanAct("admin.money")
  const [month, setMonth] = useState(thisMonth())
  const valid = /^\d{4}-\d{2}$/.test(month)
  const { data: s } = useQuery<MoneySummary>({
    queryKey: ["admin-money-summary"],
    queryFn: async () => (await api.get(`${MONEY}/summary`)).data,
  })

  const release = useMutation({
    mutationFn: async () => (await api.post<{ released: number }>(`${MONEY}/release-due`)).data,
    onSuccess: (d) => {
      toast.success(d.released ? `Released ${num(d.released)} ${d.released === 1 ? "transfer" : "transfers"}` : "Nothing was due")
      qc.invalidateQueries({ queryKey: ["admin-money-summary"] })
      qc.invalidateQueries({ queryKey: ["admin-money-transfers"] })
      qc.invalidateQueries({ queryKey: ["admin-money-creators"] })
    },
    onError: (err) => toast.error(detail(err, "Could not release the due transfers")),
  })

  const issue = useMutation({
    mutationFn: async () => (await api.post<{ issued: number }>(`${MONEY}/commission-invoices`, null, { params: { month } })).data,
    onSuccess: (d) => toast.success(d.issued ? `Issued ${num(d.issued)} commission ${d.issued === 1 ? "invoice" : "invoices"} for ${month}` : `No new invoices to issue for ${month}`),
    onError: (err) => toast.error(detail(err, "Could not issue the commission invoices")),
  })

  async function releaseDue() {
    const ok = await confirm({
      title: "Release due transfers?",
      message: "Every held transfer whose refund window or reserve hold has ended is released to the creator's bank account. This cannot be undone.",
      confirmLabel: "Release",
    })
    if (ok) release.mutate()
  }

  async function issueMonth() {
    const ok = await confirm({
      title: `Issue commission invoices for ${month}?`,
      message: "One tax invoice per creator for the commission kept that month. Sales already invoiced are skipped.",
      confirmLabel: "Issue invoices",
    })
    if (ok) issue.mutate()
  }

  const accounts = Object.entries(s?.accounts ?? {})

  return (
    <div className="space-y-6">
      {s && s.failed > 0 && (
        <div role="status" className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-slate-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p><b>{num(s.failed)} pending {s.failed === 1 ? "transfer has" : "transfers have"} an error.</b> Retry them from the Transfers tab.</p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sales, all time</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard size="sm" label="Gross sales" value={s ? inr(s.gross_minor) : "—"} hint={s ? `${num(s.sales)} sales` : undefined} icon={<Wallet size={17} />} />
          <StatCard size="sm" label="Commission" value={s ? inr(s.commission_minor) : "—"} icon={<Receipt size={17} />} accent="green" />
          <StatCard size="sm" label="TCS collected" value={s ? inr(s.tcs_minor) : "—"} icon={<FileText size={17} />} accent="navy" />
          <StatCard size="sm" label="TDS withheld" value={s ? inr(s.tds_minor) : "—"} icon={<FileText size={17} />} accent="navy" />
          <StatCard size="sm" label="Refunded" value={s ? inr(s.refunded_minor) : "—"} icon={<ArrowDownLeft size={17} />} accent="red" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Creator money</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard size="sm" label="Held" value={s ? inr(s.held_minor) : "—"} hint="Refund window" icon={<Clock size={17} />} accent="amber" />
          <StatCard size="sm" label="Reserve" value={s ? inr(s.reserve_minor) : "—"} hint="For disputes" icon={<ShieldCheck size={17} />} accent="amber" />
          <StatCard size="sm" label="Pending" value={s ? inr(s.pending_minor) : "—"} hint="Going out" icon={<Truck size={17} />} accent="blue" />
          <StatCard size="sm" label="Released" value={s ? inr(s.released_minor) : "—"} hint="Paid out" icon={<Landmark size={17} />} accent="green" />
          <StatCard size="sm" label="Owed back" value={s ? inr(s.owed_back_minor) : "—"} hint="To recover" icon={<ArrowDownLeft size={17} />} accent="red" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-4">
          <SectionHeading>Payout accounts</SectionHeading>
          {accounts.length === 0 ? (
            <p className="text-sm text-slate-500">No creator has started payout setup.</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map(([k, v]) => (
                <li key={k} className="flex items-center justify-between text-sm">
                  <Status map={ACCOUNT_STATUS} status={k} />
                  <span className="font-num font-semibold text-navy">{num(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <SectionHeading>Releases</SectionHeading>
          <p className="text-sm text-slate-600">
            The scheduler releases held money once its hold ends. Run it now if a release was missed.
          </p>
          {canAct ? (
            <Button onClick={releaseDue} disabled={release.isPending}>
              <Landmark size={14} /> {release.isPending ? "Releasing…" : "Release due transfers"}
            </Button>
          ) : (
            <p className="text-xs text-slate-500">You need full access to creator money to release transfers.</p>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <SectionHeading>Month end</SectionHeading>
          <Field label="Month">
            <Input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {canAct && (
              <Button size="sm" onClick={issueMonth} disabled={!valid || issue.isPending}>
                <Receipt size={13} /> {issue.isPending ? "Issuing…" : "Issue commission invoices"}
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!valid}
              onClick={() => downloadFile(`${MONEY}/reports/gstr8.csv?month=${month}`, `gstr8-${month}.csv`)}>
              <FileDown size={13} /> GSTR-8 CSV
            </Button>
            <Button size="sm" variant="outline" disabled={!valid}
              onClick={() => downloadFile(`${MONEY}/reports/tds-194o.csv?month=${month}`, `tds-194o-${month}.csv`)}>
              <FileDown size={13} /> 194-O TDS CSV
            </Button>
          </div>
          <p className="text-xs text-slate-500">GSTR-8 is the TCS return for the e-commerce operator; 194-O is the TDS withheld from creators.</p>
        </Card>
      </div>
    </div>
  )
}
