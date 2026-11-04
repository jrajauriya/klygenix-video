import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, FileDown } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, PageHeader, Spinner, cn, downloadFile, useConfirm } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { useMe, usePlans } from "../lib/hooks"
import { detail, when } from "../lib/format"
import type { Checkout, Invoice, Plan } from "../lib/types"
import { UsageMeters } from "../components/UsageMeters"
import { CheckoutModal } from "../components/billing/CheckoutModal"
import { useT, type T } from "../i18n"

function perks(p: Plan, t: T): string[] {
  const l = p.limits ?? {}
  const out: string[] = []
  if (typeof l.ai_minutes === "number") out.push(t("{n} AI minutes a month", { n: l.ai_minutes.toLocaleString("en-IN") }))
  if (typeof l.renders === "number") out.push(t("{n} clip renders a month", { n: l.renders.toLocaleString("en-IN") }))
  out.push(l.watermark ? t("Klygenix Play watermark on clips") : t("No watermark on clips"))
  if (typeof l.seats === "number") out.push(l.seats === 1 ? t("1 seat") : t("{n} seats", { n: l.seats }))
  if (l.priority) out.push(t("Priority renders"))
  return out
}

export default function Billing() {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: me, isLoading } = useMe()
  const { data: plans } = usePlans()
  const { data: invoices } = useQuery({
    queryKey: ["video-invoices"],
    queryFn: async () => (await api.get<Invoice[]>("/api/video/me/invoices")).data,
  })
  const [checkout, setCheckout] = useState<{ checkout: Checkout; plan: Plan } | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  if (isLoading || !me) return <Spinner />

  const current = me.plans.creator
  const sub = me.subscriptions.find((s) => s.audience === "creator")
  const creatorPlans = (plans ?? []).filter((p) => p.audience === "creator")

  async function upgrade(plan: Plan) {
    setStarting(plan.key)
    try {
      const { data } = await api.post<Checkout>("/api/video/checkout", { plan_key: plan.key })
      setCheckout({ checkout: data, plan })
    } catch (err) {
      toast.error(detail(err, t("Could not start the payment")))
    } finally {
      setStarting(null)
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: t("Cancel {name}?", { name: current.name }),
      message: sub?.current_period_end
        ? t("You keep everything until {date}. After that you move to Creator Free.", { date: when(sub.current_period_end) })
        : t("You move to Creator Free at the end of the period you paid for."),
      confirmLabel: t("Cancel plan"),
      cancelLabel: t("Keep plan"),
      variant: "destructive",
    })
    if (!ok) return
    setCancelling(true)
    try {
      const { data } = await api.post<{ cancelled: boolean; ends_at: string | null }>("/api/video/me/plans/creator/cancel")
      toast.success(data.ends_at ? t("Cancelled. Your plan runs until {date}.", { date: when(data.ends_at) }) : t("Cancelled"))
      qc.invalidateQueries({ queryKey: ["video-me"] })
    } catch (err) {
      toast.error(detail(err, t("Could not cancel the plan")))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="pb-8">
      <PageHeader title={t("Plan & billing")} subtitle={t("Your creator plan, what you have used this month, and your invoices.")} />

      <div className="space-y-4">
        <Card className="grid gap-5 p-5 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-500">{t("Current plan")}</p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-lg font-bold text-navy">{current.name}</h2>
              {sub?.status === "grace" && <Badge color="amber">{t("Payment due")}</Badge>}
              {sub?.cancel_at_period_end && <Badge color="slate">{t("Ends {date}", { date: when(sub.current_period_end) })}</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-600">{current.description}</p>
            {sub?.current_period_end && !sub.cancel_at_period_end && (
              <p className="mt-2 text-xs text-slate-500">{t("Renews on {date}", { date: when(sub.current_period_end) })}</p>
            )}
            {!current.free && sub && !sub.cancel_at_period_end && (
              <Button variant="ghost" size="sm" className="mt-3 text-red-600" onClick={cancel} disabled={cancelling}>
                {cancelling ? t("Cancelling…") : t("Cancel plan")}
              </Button>
            )}
          </div>
          <UsageMeters usage={me.usage} />
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {creatorPlans.map((p) => {
            const on = p.key === current.key
            const renewable = on && sub?.cancel_at_period_end
            return (
              <Card key={p.key} className={cn("flex flex-col p-5", on && "ring-2 ring-brand")}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-navy">{p.name}</h3>
                  {on && <Badge color="brand">{t("Current")}</Badge>}
                </div>
                <p className="mt-2 text-2xl font-bold text-navy">{p.free ? t("Free") : formatMoney(p.price_minor, p.currency)}</p>
                <p className="text-xs text-slate-500">{p.free ? t("Always") : t("a month, plus GST")}</p>
                <p className="mt-2 text-sm text-slate-600">{p.description}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-700">
                  {perks(p, t).map((x) => (
                    <li key={x} className="flex gap-1.5"><Check size={15} className="mt-0.5 shrink-0 text-brand" /> {x}</li>
                  ))}
                </ul>
                {!p.free && (!on || renewable) && (
                  <Button className="mt-4" onClick={() => upgrade(p)} disabled={starting !== null}>
                    {starting === p.key ? t("Starting…") : renewable ? t("Keep this plan") : current.free ? t("Upgrade") : t("Switch")}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      <Card className="mt-5 p-0">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-bold text-navy">{t("Invoices")}</h2>
        </div>
        {!invoices?.length ? (
          <p className="px-5 py-6 text-sm text-slate-500">{t("No invoices yet. They appear here after your first payment.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-num font-semibold text-slate-800">{i.number}</span>
                <span className="text-slate-500">{when(i.date)}</span>
                {i.kind !== "invoice" && <Badge color="slate">{i.kind.replace(/_/g, " ")}</Badge>}
                <span className="ml-auto font-num">{formatMoney(i.total_minor, i.currency)}</span>
                <Button size="sm" variant="outline" disabled={!i.has_pdf}
                  onClick={() => downloadFile(`/api/video/me/invoices/${i.id}.pdf`, `${i.number.replace(/[^\w-]+/g, "_")}.pdf`)}>
                  <FileDown size={13} /> PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {checkout && <CheckoutModal checkout={checkout.checkout} plan={checkout.plan} onClose={() => setCheckout(null)} />}
    </div>
  )
}
