import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Lock } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Modal } from "@klygenixvideo/ui"
import { detail } from "../lib/format"
import type { PayableCheckout } from "../lib/market"
import { inr } from "./earnings/shared"
import { loadRazorpay } from "./billing/CheckoutModal"
import { tr, useT } from "../i18n"

export function PayModal({
  checkout,
  title,
  description,
  children,
  onPaid,
  onClose,
}: {
  checkout: PayableCheckout
  title: string
  description: string
  children?: ReactNode
  onPaid: () => void
  onClose: () => void
}) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const sandbox = checkout.rail === "sandbox"
  const done = useRef(onPaid)
  done.current = onPaid

  useEffect(() => {
    if (!waiting) return
    let tries = 0
    const timer = setInterval(async () => {
      tries += 1
      try {
        const { data } = await api.get<{ status: string }>(`/api/video/checkout/${checkout.id}`)
        if (data.status === "paid") {
          clearInterval(timer)
          done.current()
          return
        }
        if (data.status === "failed") {
          clearInterval(timer)
          setWaiting(false)
          setBusy(false)
          toast.error(tr("The payment failed. Nothing was charged."))
          return
        }
      } catch {
        return
      }
      if (tries >= 20) {
        clearInterval(timer)
        setWaiting(false)
        setBusy(false)
        toast.error(tr("The payment has not been confirmed yet. Refresh this page in a minute."))
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [waiting, checkout.id])

  async function sandboxPay(outcome: "captured" | "failed") {
    setBusy(true)
    try {
      await api.post(`/api/video/sandbox/pay/${checkout.id}?outcome=${outcome}`)
      if (outcome === "failed") {
        toast.error(t("The test payment failed. Nothing was charged."))
        setBusy(false)
        return
      }
      setWaiting(true)
    } catch (err) {
      toast.error(detail(err, t("The payment did not go through")))
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
      currency: c.currency ?? "INR",
      name: "Klygenix Play",
      description,
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
    else toast.error(t("This payment method is not available right now"))
  }

  const hasTax = typeof checkout.taxable_minor === "number" && typeof checkout.tax_minor === "number"

  return (
    <Modal
      open
      size="sm"
      onClose={busy ? () => undefined : onClose}
      dismissible={!busy}
      title={title}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("Cancel")}</Button>
          {sandbox && (
            <Button variant="outline" className="text-red-700" onClick={() => sandboxPay("failed")} disabled={busy}>{t("Fail")}</Button>
          )}
          <Button onClick={pay} disabled={busy}>
            <Lock size={14} /> {waiting ? t("Confirming…") : busy ? t("Paying…") : t("Pay {amount}", { amount: inr(checkout.amount_minor) })}
          </Button>
        </div>
      }
    >
      <dl className="space-y-1.5 text-sm">
        {hasTax && (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">{description}</dt>
              <dd className="font-num">{inr(checkout.taxable_minor)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">GST</dt>
              <dd className="font-num">{inr(checkout.tax_minor)}</dd>
            </div>
          </>
        )}
        <div className={`flex justify-between gap-3 font-semibold text-navy ${hasTax ? "border-t border-slate-200 pt-1.5" : ""}`}>
          <dt>{hasTax ? t("Total") : description}</dt>
          <dd className="font-num">{inr(checkout.amount_minor)}</dd>
        </div>
      </dl>
      {children && <div className="mt-4 text-xs leading-relaxed text-slate-600">{children}</div>}
      {sandbox && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("Test mode: no money moves. Pay confirms the payment, Fail shows what a declined payment looks like.")}
        </p>
      )}
    </Modal>
  )
}
