import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Lock } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Modal } from "@klygenixvideo/ui"
import { formatMoney } from "@klygenixvideo/client"
import { detail } from "../../lib/format"
import type { Checkout, Me, Plan } from "../../lib/types"

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://checkout.razorpay.com/v1/checkout.js"
    s.onload = () => resolve()
    s.onerror = () => reject(new Error("Razorpay could not be loaded. Check your connection."))
    document.body.appendChild(s)
  })
}

export function CheckoutModal({ checkout, plan, onClose }: { checkout: Checkout; plan: Plan; onClose: () => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const sandbox = checkout.rail === "sandbox"
  const money = (minor: number) => formatMoney(minor, checkout.currency)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!waiting) return
    let tries = 0
    const timer = setInterval(async () => {
      tries += 1
      try {
        const { data } = await api.get<Me>("/api/video/me")
        qc.setQueryData(["video-me"], data)
        if (data.plans.creator.key === plan.key) {
          clearInterval(timer)
          qc.invalidateQueries({ queryKey: ["video-invoices"] })
          toast.success(`You are on ${plan.name}`)
          close.current()
          return
        }
      } catch {
        return
      }
      if (tries >= 20) {
        clearInterval(timer)
        setWaiting(false)
        setBusy(false)
        toast.error("The payment has not been confirmed yet. Refresh this page in a minute.")
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [waiting, plan.key, plan.name, qc])

  async function sandboxPay(outcome: "captured" | "failed") {
    setBusy(true)
    try {
      await api.post(`/api/video/sandbox/pay/${checkout.id}?outcome=${outcome}`)
      if (outcome === "failed") {
        toast.error("The test payment failed. Nothing was charged.")
        setBusy(false)
        return
      }
      setWaiting(true)
    } catch (err) {
      toast.error(detail(err, "The payment did not go through"))
      setBusy(false)
    }
  }

  async function razorpay() {
    const c = checkout.client ?? {}
    setBusy(true)
    try {
      await loadRazorpay()
    } catch (err) {
      toast.error((err as Error).message)
      setBusy(false)
      return
    }
    const rzp = new window.Razorpay!({
      key: c.key_id,
      order_id: c.order_id,
      amount: c.amount ?? checkout.amount_minor,
      currency: c.currency ?? checkout.currency,
      name: "Klygenix Play",
      description: `${plan.name}, one month`,
      prefill: c.prefill,
      theme: { color: "#A21CAF" },
      handler: () => setWaiting(true),
      modal: { ondismiss: () => setBusy(false) },
    })
    rzp.open()
  }

  function pay() {
    if (sandbox) return sandboxPay("captured")
    if (checkout.rail === "razorpay") return razorpay()
    const url = checkout.client?.url
    if (typeof url === "string") window.location.assign(url)
    else toast.error("This payment method is not available right now")
  }

  return (
    <Modal
      open
      size="sm"
      onClose={busy ? () => undefined : onClose}
      dismissible={!busy}
      title={`Move to ${plan.name}`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {sandbox && (
            <Button variant="outline" className="text-red-600" onClick={() => sandboxPay("failed")} disabled={busy}>Fail</Button>
          )}
          <Button onClick={pay} disabled={busy}>
            <Lock size={14} /> {waiting ? "Confirming…" : busy ? "Paying…" : `Pay ${money(checkout.amount_minor)}`}
          </Button>
        </div>
      }
    >
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">{plan.name}, one month</dt>
          <dd className="font-num">{money(checkout.taxable_minor)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">GST</dt>
          <dd className="font-num">{money(checkout.tax_minor)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-slate-200 pt-1.5 font-semibold text-navy">
          <dt>Total</dt>
          <dd className="font-num">{money(checkout.amount_minor)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        The plan starts as soon as the payment is confirmed and renews monthly until you cancel. A GST invoice is emailed and listed below.
      </p>
      {sandbox && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Test mode: no money moves. Pay confirms the plan, Fail shows what a declined payment looks like.
        </p>
      )}
    </Modal>
  )
}
