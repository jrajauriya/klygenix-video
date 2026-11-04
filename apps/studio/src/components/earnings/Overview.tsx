import type { ReactNode } from "react"
import { ArrowDownLeft, CalendarClock, Clock, Landmark, ShieldCheck, Truck } from "lucide-react"
import { Card } from "@klygenixvideo/ui"
import { when } from "../../lib/format"
import type { Earnings } from "../../lib/types"
import { PURPOSES, inr } from "./shared"
import { useLang, useT } from "../../i18n"

function Tile({ label, value, icon, children }: { label: string; value: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex gap-3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand" aria-hidden="true">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="font-num text-lg font-bold text-navy">{value}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{children}</p>
      </div>
    </Card>
  )
}

function Line({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? "border-t border-slate-100 pt-2 font-bold text-navy" : "text-slate-600"}`}>
      <dt>{label}</dt>
      <dd className="font-num">{minus && value ? `− ${inr(value)}` : inr(value)}</dd>
    </div>
  )
}

export function Overview({ data }: { data: Earnings }) {
  const t = useT()
  const lang = useLang()
  const b = data.balances
  const totals = data.month_totals
  const days = data.refund_window_days
  const reservePct = data.reserve_bps / 100
  const commissionPct = data.commission_bps / 100
  const monthName = new Date(`${data.month}-01T00:00:00`).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric" })
  const most = Math.max(1, ...PURPOSES.map((p) => data.month_by_purpose[p.key] ?? 0))

  return (
    <div className="space-y-5">
      <section aria-labelledby="balances-h">
        <h2 id="balances-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Balances")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Tile label={t("Held")} value={inr(b.held_minor)} icon={<Clock size={17} />}>
            {t("Your share of recent sales, held for the {days}-day refund window before it is released.", { days })}
          </Tile>
          <Tile label={t("Reserve")} value={inr(b.reserve_minor)} icon={<ShieldCheck size={17} />}>
            {t("{pct}% of each sale, kept a little longer to cover disputes and chargebacks, then released.", { pct: reservePct })}
          </Tile>
          <Tile label={t("On the way")} value={inr(b.pending_minor)} icon={<Truck size={17} />}>
            {t("Released by us and on its way to your bank account.")}
          </Tile>
          <Tile label={t("Released")} value={inr(b.released_minor)} icon={<Landmark size={17} />}>
            {t("Paid out to your bank so far.")}
          </Tile>
          <Tile label={t("Owed back")} value={inr(b.owed_back_minor)} icon={<ArrowDownLeft size={17} />}>
            {t("Refunds made after the money was released. It comes out of your next payouts.")}
          </Tile>
          <Tile label={t("Next release")} value={b.next_release_at ? when(b.next_release_at) : "—"} icon={<CalendarClock size={17} />}>
            {b.next_release_at ? t("When the oldest held money is due to be released.") : t("Nothing is waiting to be released.")}
          </Tile>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy">{monthName}</h2>
          <p className="mb-3 text-xs text-slate-500">
            {t("Klygenix Play keeps {pct}% commission plus GST on it. TCS and TDS are withheld for the government and show on your statement.", { pct: commissionPct })}
          </p>
          <dl>
            <Line label={t("Sales")} value={totals.gross_minor} />
            <Line label={t("Commission")} value={totals.commission_minor} minus />
            <Line label={t("GST on commission")} value={totals.commission_tax_minor} minus />
            <Line label="TCS (GST)" value={totals.tcs_minor} minus />
            <Line label="TDS (194-O)" value={totals.tds_minor} minus />
            <Line label={t("Refunded")} value={totals.refunded_minor} minus />
            <Line label={t("Your share")} value={totals.net_minor} strong />
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy">{t("Sales by kind")}</h2>
          <p className="mb-3 text-xs text-slate-500">{t("What viewers paid this month, before deductions.")}</p>
          <ul className="space-y-3">
            {PURPOSES.map((p) => {
              const v = data.month_by_purpose[p.key] ?? 0
              return (
                <li key={p.key}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700">{t(p.label)} <span className="text-xs text-slate-500">· {t(p.hint)}</span></span>
                    <span className="font-num font-semibold text-navy">{inr(v)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(v / most) * 100}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
