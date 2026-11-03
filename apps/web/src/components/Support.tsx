import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Check, Coins, Crown, FlaskConical, Loader2 } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { errText, getJson, loginPath, useSignedIn } from "../lib/api"
import { feeText } from "../lib/support"
import { rupees } from "../lib/format"
import { loadRazorpay } from "../lib/razorpay"
import type { ChannelSupport, MemberTier, SupportCheckout, SupportPurpose } from "../lib/types"
import { Sheet } from "./Sheet"
import { Btn, Field, INPUT, TEXTAREA } from "./bits"

export interface PayRequest {
  body: { purpose: SupportPurpose } & Record<string, unknown>
  label: string
  done?: string
  onPaid?: () => unknown
}

async function waitForCheckout(id: number): Promise<"paid" | "failed" | "timeout"> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 600 : 1500))
    try {
      const chk = await getJson<SupportCheckout>(`/api/video/checkout/${id}`)
      if (chk.status === "paid") return "paid"
      if (["failed", "cancelled", "expired"].includes(chk.status)) return "failed"
    } catch {
      continue
    }
  }
  return "timeout"
}

export function usePay() {
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [busy, setBusy] = useState<string | null>(null)
  const [sandbox, setSandbox] = useState<{ checkout: SupportCheckout; req: PayRequest } | null>(null)
  const [paying, setPaying] = useState<"captured" | "failed" | null>(null)

  async function settle(req: PayRequest, id: number) {
    const result = await waitForCheckout(id)
    if (result === "paid") {
      await req.onPaid?.()
      toast.success(req.done ?? "Payment received. Thank you!")
    } else if (result === "failed") toast.error("The payment did not go through. You have not been charged.")
    else toast.message("Payment received. It will show up in a moment.")
  }

  async function start(req: PayRequest, key: string = req.body.purpose): Promise<boolean> {
    if (!signedIn) {
      navigate(loginPath())
      return false
    }
    setBusy(key)
    try {
      const { data } = await api.post<SupportCheckout>("/api/video/support/checkout", req.body)
      const client = data.client ?? {}
      if (data.rail === "sandbox") {
        setSandbox({ checkout: data, req })
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
          description: req.label,
          prefill: { email: user?.email, name: user?.name, ...((client.prefill as Record<string, unknown>) ?? {}) },
          theme: { color: "#A21CAF" },
          handler: () => {
            toast.message("Confirming your payment…")
            settle(req, data.id)
          },
        })
        rzp.on("payment.failed", () => toast.error("The payment did not go through."))
        rzp.open()
      } else if (typeof client.url === "string") {
        window.location.href = client.url
      } else {
        toast.error("This payment method is not available here yet.")
        return false
      }
      return true
    } catch (err) {
      toast.error(errText(err, "Checkout could not start. Try again."))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function paySandbox(outcome: "captured" | "failed") {
    if (!sandbox) return
    setPaying(outcome)
    try {
      await api.post(`/api/video/sandbox/pay/${sandbox.checkout.id}`, null, { params: { outcome } })
      const { req, checkout } = sandbox
      setSandbox(null)
      if (outcome === "failed") toast.message("Sandbox: payment marked as failed.")
      await settle(req, checkout.id)
    } catch (err) {
      toast.error(errText(err, "The sandbox payment did not go through."))
    } finally {
      setPaying(null)
    }
  }

  const chk = sandbox?.checkout
  const sheet = (
    <Sheet
      open={sandbox !== null}
      onClose={() => !paying && setSandbox(null)}
      title={<span className="inline-flex items-center gap-2"><FlaskConical size={17} className="text-brand-soft" /> Sandbox payment</span>}
      footer={
        <>
          <Btn tone="soft" onClick={() => paySandbox("failed")} disabled={paying !== null}>{paying === "failed" ? "Failing…" : "Fail (sandbox)"}</Btn>
          <Btn tone="brand" onClick={() => paySandbox("captured")} disabled={paying !== null}>{paying === "captured" ? "Paying…" : "Pay (sandbox)"}</Btn>
        </>
      }
    >
      {sandbox && chk && (
        <div className="space-y-4">
          <p className="text-sm text-muted">This is a test checkout. No real money moves. Choose what the payment should do.</p>
          <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">For</dt><dd className="min-w-0 truncate text-right font-semibold">{sandbox.req.label}</dd></div>
            {chk.tax_minor > 0 && (
              <>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Price</dt><dd>{rupees(chk.taxable_minor ?? chk.amount_minor - chk.tax_minor, chk.currency)}</dd></div>
                <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Tax</dt><dd>{rupees(chk.tax_minor, chk.currency)}</dd></div>
              </>
            )}
            <div className="flex justify-between px-4 py-2.5 font-bold"><dt>Total</dt><dd>{rupees(chk.amount_minor, chk.currency)}</dd></div>
          </dl>
        </div>
      )}
    </Sheet>
  )

  return { start, busy, sheet }
}

const PRESETS = [2000, 5000, 10000, 50000]

export function TipSheet({
  open, onClose, support, name, videoId, onPaid,
}: {
  open: boolean
  onClose: () => void
  support: ChannelSupport
  name: string
  videoId?: string
  onPaid?: () => unknown
}) {
  const pay = usePay()
  const min = support.tip_min_minor
  const max = support.tip_max_minor
  const presets = PRESETS.filter((p) => p >= min && p <= max)
  const [amount, setAmount] = useState<number>(presets[2] ?? presets[0] ?? min)
  const [custom, setCustom] = useState("")
  const [message, setMessage] = useState("")
  const value = custom.trim() ? Math.round(Number(custom) * 100) : amount
  const valid = Number.isFinite(value) && value >= min && value <= max

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    onClose()
    await pay.start({
      body: { purpose: "tip", amount_minor: value, message: message.trim() || undefined, ...(videoId ? { video_id: videoId } : { channel: support.channel }) },
      label: `${rupees(value)} tip for ${name}`,
      done: `You tipped ${name} ${rupees(value)}. Thank you!`,
      onPaid: async () => {
        setMessage("")
        setCustom("")
        await onPaid?.()
      },
    }, "tip")
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={<span className="inline-flex items-center gap-2"><Coins size={17} className="text-brand-soft" aria-hidden="true" /> Tip {name}</span>}
        footer={
          <>
            <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
            <Btn tone="brand" type="submit" form="tip-form" disabled={!valid || pay.busy !== null}>
              {pay.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              Tip {valid ? rupees(value) : ""}
            </Btn>
          </>
        }
      >
        <form id="tip-form" onSubmit={submit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted">Amount</legend>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={!custom.trim() && amount === p}
                  onClick={() => { setAmount(p); setCustom("") }}
                  className={cn(
                    "h-11 rounded-xl text-sm font-bold transition-colors",
                    !custom.trim() && amount === p ? "bg-brand text-white" : "bg-white/[0.08] text-ink hover:bg-white/15",
                  )}
                >
                  {rupees(p)}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="Or enter an amount (₹)" hint={`Between ${rupees(min)} and ${rupees(max)}.`}>
            <input
              className={INPUT}
              type="number"
              inputMode="numeric"
              min={min / 100}
              max={max / 100}
              step={1}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={String((presets[2] ?? min) / 100)}
            />
          </Field>
          <Field label="Message (optional)" hint={`${message.length}/200 · Shown with your tip${videoId ? " as a highlighted comment" : ""}.`}>
            <textarea className={`${TEXTAREA} resize-none`} rows={3} maxLength={200} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 200))} />
          </Field>
          <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-xs leading-relaxed text-muted">
            Your tip goes to {name}, minus {feeText(support)} and taxes. Tips are not refundable.
          </p>
        </form>
      </Sheet>
      {pay.sheet}
    </>
  )
}

export function perksOf(tier: Pick<MemberTier, "perks">): string[] {
  return (tier.perks ?? "").split(/\r?\n|;/).map((p) => p.trim().replace(/^[-•*]\s*/, "")).filter(Boolean)
}

export function TierBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-[#FACC15] px-1.5 py-0.5 text-[11px] font-bold text-black", className)}>
      <Crown size={11} aria-hidden="true" />
      {children}
    </span>
  )
}

export function MembershipTiers({ support, channelName, onJoined }: { support: ChannelSupport; channelName: string; onJoined?: () => unknown }) {
  const signedIn = useSignedIn()
  const pay = usePay()
  const tiers = support.tiers.filter((t) => t.is_active)

  function join(t: MemberTier) {
    pay.start({
      body: { purpose: "membership", tier_id: t.id },
      label: `${t.name} membership · ${channelName}`,
      done: `Welcome to ${t.name}! You are a member of ${channelName} now.`,
      onPaid: onJoined,
    }, `tier-${t.id}`)
  }

  return (
    <div className="space-y-4">
      {!support.can_take_money && !support.is_owner && (
        <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm text-muted">This channel can't take new members right now.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((t) => {
          const mine = support.my_rank === t.rank
          const included = support.my_rank > t.rank
          const perks = perksOf(t)
          return (
            <div key={t.id} className={cn("flex flex-col rounded-2xl border p-5", mine ? "border-brand/70 bg-gradient-to-b from-brand/20 to-panel" : "border-line bg-panel")}>
              <div className="flex items-center gap-2">
                <TierBadge>{t.badge || "Member"}</TierBadge>
                {mine && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-ink">Your tier</span>}
              </div>
              <h3 className="mt-3 text-lg font-bold">{t.name}</h3>
              <p className="mt-1"><span className="text-2xl font-bold">{rupees(t.price_minor, t.currency)}</span> <span className="text-sm text-muted">/ month</span></p>
              {perks.length > 0 ? (
                <ul className="mt-4 flex-1 space-y-2">
                  {perks.map((p) => <li key={p} className="flex items-start gap-2 text-sm text-ink/85"><Check size={16} className="mt-0.5 shrink-0 text-brand-soft" aria-hidden="true" /> {p}</li>)}
                </ul>
              ) : (
                <p className="mt-4 flex-1 text-sm text-muted">Members-only videos from {channelName}.</p>
              )}
              <div className="mt-5">
                {support.is_owner ? (
                  <p className="text-center text-xs text-muted">This is your channel.</p>
                ) : mine ? (
                  <Link to="/account?tab=memberships" className="flex h-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold hover:bg-white/15">Manage membership</Link>
                ) : included ? (
                  <p className="flex h-10 items-center justify-center text-sm text-muted">Included in your tier</p>
                ) : !signedIn ? (
                  <Link to={loginPath()} className="flex h-10 items-center justify-center rounded-full bg-snow text-sm font-semibold text-black hover:bg-snow/85">Sign in to join</Link>
                ) : (
                  <Btn tone="brand" className="w-full" onClick={() => join(t)} disabled={!support.can_take_money || pay.busy !== null}>
                    {pay.busy === `tier-${t.id}` ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                    {support.my_rank > 0 ? "Upgrade" : "Join"}
                  </Btn>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-faint">Memberships renew every month. Cancel anytime from your account; you keep access until the period ends.</p>
      {pay.sheet}
    </div>
  )
}
