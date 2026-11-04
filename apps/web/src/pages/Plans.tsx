import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Crown, FlaskConical, Loader2, Sparkles, Video } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { formatMoney } from "@klygenixvideo/client"
import { cn, useConfirm } from "@klygenixvideo/ui"
import { PageShell } from "../components/Layout"
import { Sheet } from "../components/Sheet"
import { Btn, Skel } from "../components/bits"
import { errText, getJson, loginPath, useMe, useSignedIn } from "../lib/api"
import { longDate } from "../lib/format"
import { loadRazorpay } from "../lib/razorpay"
import { useTitle } from "../lib/title"
import type { Checkout, Me, Plan } from "../lib/types"
import { useT, type T } from "../i18n"
import { rich } from "../i18n/rich"

const LIMIT_LABELS: Record<string, (v: number | boolean, t: T) => string | null> = {
  ask_per_day: (v, t) => t("{n} Ask questions a day", { n: Number(v) }),
  languages: (v, t) => (Number(v) >= 6 ? t("Subtitles in every language") : t("Subtitles in {n} languages", { n: Number(v) })),
  notes: (v, t) => (v ? t("Notes on videos") : null),
  ai_minutes: (v, t) => t("{n} AI minutes a month", { n: Number(v) }),
  renders: (v, t) => t("{n} clip renders a month", { n: Number(v) }),
  seats: (v, t) => (Number(v) > 1 ? t("{n} team seats", { n: Number(v) }) : t("1 seat")),
  watermark: (v, t) => (v ? t("Klygenix watermark on clips") : t("No watermark")),
  priority: (v, t) => (v ? t("Priority renders") : null),
}

function features(plan: Plan, t: T): string[] {
  return Object.entries(plan.limits ?? {})
    .map(([k, v]) => LIMIT_LABELS[k]?.(v, t) ?? null)
    .filter((x): x is string => Boolean(x))
}

async function waitForPlan(planKey: string, audience: "viewer" | "creator", checkoutId: number): Promise<"active" | "failed" | "timeout"> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const [me, chk] = await Promise.all([
        getJson<Me>("/api/video/me"),
        getJson<Checkout>(`/api/video/checkout/${checkoutId}`).catch(() => null),
      ])
      if (me.plans[audience]?.key === planKey) return "active"
      if (chk && ["failed", "cancelled", "expired"].includes(chk.status)) return "failed"
    } catch {
      continue
    }
  }
  return "timeout"
}

function PlanCard({ plan, current, sub, onUpgrade, onCancel, busy }: {
  plan: Plan
  current: boolean
  sub?: Me["subscriptions"][number]
  onUpgrade: () => void
  onCancel: () => void
  busy: boolean
}) {
  const t = useT("plans")
  const highlight = !plan.free && (plan.key === "viewer_premium" || plan.key === "creator_pro")
  return (
    <div className={cn("relative flex flex-col rounded-3xl border p-5 sm:p-6", highlight ? "border-brand/70 bg-gradient-to-b from-brand/20 to-panel" : "border-line bg-panel")}>
      {highlight && <span className="absolute -top-3 left-5 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{t("Popular")}</span>}
      <h3 className="text-lg font-bold">{plan.name}</h3>
      <p className="mt-1 min-h-10 text-sm text-muted">{plan.description}</p>
      <p className="mt-4">
        <span className="text-3xl font-bold">{plan.free ? t("Free") : formatMoney(plan.price_minor, plan.currency)}</span>
        {!plan.free && <span className="ml-1 text-sm text-muted">{t("/ month")}</span>}
      </p>
      {!plan.free && <p className="text-xs text-faint">{t("Taxes shown at checkout")}</p>}
      <ul className="mt-5 flex-1 space-y-2">
        {features(plan, t).map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-ink/85"><Check size={16} className="mt-0.5 shrink-0 text-brand-soft" aria-hidden="true" /> {f}</li>
        ))}
      </ul>
      <div className="mt-6">
        {current ? (
          <div className="space-y-2">
            <div className="flex h-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">{t("Your current plan")}</div>
            {sub && (
              <p className="text-center text-xs text-muted">
                {sub.cancel_at_period_end ? t("Ends on {date}", { date: longDate(sub.current_period_end) }) : t("Renews on {date}", { date: longDate(sub.current_period_end) })}
              </p>
            )}
            {sub && !sub.cancel_at_period_end && !plan.free && (
              <Btn tone="ghost" size="sm" className="w-full text-muted" onClick={onCancel}>{t("Cancel plan")}</Btn>
            )}
            {sub?.cancel_at_period_end && <Btn tone="brand" className="w-full" onClick={onUpgrade} disabled={busy}>{t("Resume plan")}</Btn>}
          </div>
        ) : plan.free ? (
          <div className="h-10" />
        ) : (
          <Btn tone={highlight ? "brand" : "light"} className="w-full" onClick={onUpgrade} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null} {t("Upgrade")}
          </Btn>
        )}
      </div>
    </div>
  )
}

export default function PlansPage() {
  const t = useT("plans")
  useTitle(t("Plans"))
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const me = useMe()
  const country = me.data?.profile?.country ?? "IN"
  const plans = useQuery({ queryKey: ["plans", country], queryFn: () => getJson<Plan[]>("/api/video/plans", { country }) })
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [sandbox, setSandbox] = useState<{ checkout: Checkout; plan: Plan } | null>(null)
  const [paying, setPaying] = useState<"captured" | "failed" | null>(null)

  async function settle(plan: Plan, checkoutId: number) {
    const result = await waitForPlan(plan.key, plan.audience, checkoutId)
    await qc.invalidateQueries({ queryKey: ["me"] })
    if (result === "active") toast.success(t("You are on {plan} now.", { plan: plan.name }))
    else if (result === "failed") toast.error(t("The payment did not go through. You have not been charged."))
    else toast.message(t("Payment received. Your plan will update in a moment."))
  }

  async function upgrade(plan: Plan) {
    if (!signedIn) {
      navigate(loginPath("/plans"))
      return
    }
    setBusyKey(plan.key)
    try {
      const { data } = await api.post<Checkout>("/api/video/checkout", { plan_key: plan.key })
      const client = data.client ?? {}
      if (data.rail === "sandbox") {
        setSandbox({ checkout: data, plan })
      } else if (data.rail === "razorpay") {
        await loadRazorpay()
        if (!window.Razorpay) throw new Error("Razorpay unavailable")
        const rzp = new window.Razorpay({
          key: client.key_id,
          order_id: client.order_id,
          subscription_id: client.subscription_id,
          amount: client.amount ?? data.amount_minor,
          currency: client.currency ?? data.currency,
          name: "Klygenix Play",
          description: plan.name,
          prefill: { email: user?.email, name: user?.name, ...((client.prefill as Record<string, unknown>) ?? {}) },
          theme: { color: "#A21CAF" },
          handler: () => {
            toast.message(t("Confirming your payment…"))
            settle(plan, data.id)
          },
        })
        rzp.on("payment.failed", () => toast.error(t("The payment did not go through.")))
        rzp.open()
      } else if (typeof client.url === "string") {
        window.location.href = client.url
      } else {
        toast.error(t("This payment method is not available here yet."))
      }
    } catch (err) {
      toast.error(errText(err, t("Checkout could not start. Try again.")))
    } finally {
      setBusyKey(null)
    }
  }

  async function paySandbox(outcome: "captured" | "failed") {
    if (!sandbox) return
    setPaying(outcome)
    try {
      await api.post(`/api/video/sandbox/pay/${sandbox.checkout.id}`, null, { params: { outcome } })
      const { plan, checkout } = sandbox
      setSandbox(null)
      if (outcome === "failed") toast.message(t("Sandbox: payment marked as failed."))
      await settle(plan, checkout.id)
    } catch (err) {
      toast.error(errText(err, t("The sandbox payment did not go through.")))
    } finally {
      setPaying(null)
    }
  }

  async function cancel(plan: Plan) {
    const ok = await confirm({
      title: t("Cancel {plan}?", { plan: plan.name }),
      message: t("You keep it until the end of the period you have paid for. After that you move to the free plan."),
      confirmLabel: t("Cancel plan"),
      cancelLabel: t("Keep plan"),
      variant: "destructive",
    })
    if (!ok) return
    try {
      const { data } = await api.post<{ cancelled: boolean; ends_at: string | null }>(`/api/video/me/plans/${plan.audience}/cancel`)
      toast.success(data.ends_at ? t("Cancelled. You keep {plan} until {date}.", { plan: plan.name, date: longDate(data.ends_at) }) : t("Cancelled."))
      qc.invalidateQueries({ queryKey: ["me"] })
    } catch (err) {
      toast.error(errText(err, t("The plan could not be cancelled.")))
    }
  }

  const list = plans.data ?? []
  const groups: { audience: "viewer" | "creator"; title: string; blurb: string; icon: React.ReactNode }[] = [
    { audience: "viewer", title: t("For viewers"), blurb: t("Ask more, read subtitles in every language."), icon: <Crown size={18} className="text-brand-soft" aria-hidden="true" /> },
    { audience: "creator", title: t("For creators"), blurb: t("More AI minutes and clip renders in Studio."), icon: <Video size={18} className="text-brand-soft" aria-hidden="true" /> },
  ]

  return (
    <PageShell className="max-w-6xl">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/20 px-3 py-1 text-xs font-semibold text-brand-soft"><Sparkles size={13} aria-hidden="true" /> {t("Plans")}</span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t("Watch free. Pay for more AI.")}</h1>
        <p className="mt-2 text-sm text-muted">{t("Every video is free to watch. Plans add AI questions, subtitle languages and creator tools. Cancel anytime.")}</p>
      </div>

      {plans.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-80 rounded-3xl" />)}</div>
      ) : (
        <div className="space-y-12">
          {groups.map((g) => {
            const items = list.filter((p) => p.audience === g.audience)
            if (!items.length) return null
            const currentKey = me.data?.plans[g.audience]?.key ?? `${g.audience}_free`
            return (
              <section key={g.audience}>
                <div className="mb-4 flex items-center gap-2">
                  {g.icon}
                  <h2 className="text-lg font-bold">{g.title}</h2>
                  <span className="hidden text-sm text-muted sm:inline">— {g.blurb}</span>
                </div>
                <div className={cn("grid gap-5 pt-3", items.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2 md:max-w-3xl")}>
                  {items.map((p) => (
                    <PlanCard
                      key={p.key}
                      plan={p}
                      current={signedIn ? currentKey === p.key : false}
                      sub={me.data?.subscriptions.find((s) => s.plan_key === p.key && (s.status === "active" || s.status === "grace"))}
                      onUpgrade={() => upgrade(p)}
                      onCancel={() => cancel(p)}
                      busy={busyKey === p.key}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <p className="mt-10 text-center text-xs text-faint">
        {rich(t("Prices include the platform fee; GST or local tax is added at checkout where it applies. Questions? See the {terms}."), { terms: <Link to="/legal/terms" className="underline hover:text-ink">{t("Terms")}</Link> })}
      </p>

      <Sheet
        open={sandbox !== null}
        onClose={() => !paying && setSandbox(null)}
        title={<span className="inline-flex items-center gap-2"><FlaskConical size={17} className="text-brand-soft" aria-hidden="true" /> {t("Sandbox payment")}</span>}
        footer={
          <>
            <Btn tone="soft" onClick={() => paySandbox("failed")} disabled={paying !== null}>{paying === "failed" ? t("Failing…") : t("Fail (sandbox)")}</Btn>
            <Btn tone="brand" onClick={() => paySandbox("captured")} disabled={paying !== null}>{paying === "captured" ? t("Paying…") : t("Pay (sandbox)")}</Btn>
          </>
        }
      >
        {sandbox && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t("This is a test checkout. No real money moves. Choose what the payment should do.")}</p>
            <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
              <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">{t("Plan")}</dt><dd className="font-semibold">{sandbox.plan.name}</dd></div>
              <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">{t("Price")}</dt><dd>{formatMoney(sandbox.checkout.taxable_minor ?? sandbox.checkout.amount_minor - sandbox.checkout.tax_minor, sandbox.checkout.currency)}</dd></div>
              <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">{t("Tax")}</dt><dd>{formatMoney(sandbox.checkout.tax_minor, sandbox.checkout.currency)}</dd></div>
              <div className="flex justify-between px-4 py-2.5 font-bold"><dt>{t("Total")}</dt><dd>{formatMoney(sandbox.checkout.amount_minor, sandbox.checkout.currency)}</dd></div>
            </dl>
          </div>
        )}
      </Sheet>
    </PageShell>
  )
}
