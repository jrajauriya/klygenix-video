import { useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Button, Field, Input, Modal } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { detail } from "../../lib/format"
import { TOPUP_MAX, TOPUP_MIN, newKey, type Campaign, type PayableCheckout } from "../../lib/market"
import { inr, parseRupees } from "../earnings/shared"
import { PayModal } from "../PayModal"

export function FundCampaign({ campaign, onClose, onPaid }: { campaign: Campaign; onClose: () => void; onPaid: () => void }) {
  const [amount, setAmount] = useState("5000")
  const [busy, setBusy] = useState(false)
  const [checkout, setCheckout] = useState<PayableCheckout | null>(null)
  const key = useMemo(() => newKey(`ad-${campaign.id}`), [campaign.id])
  const minor = parseRupees(amount)
  const error = minor === null || minor < TOPUP_MIN || minor > TOPUP_MAX
    ? `Between ${inr(TOPUP_MIN)} and ${inr(TOPUP_MAX)}.`
    : undefined

  async function start() {
    if (error || minor === null) return
    setBusy(true)
    try {
      const { data } = await api.post<PayableCheckout>(`${STUDIO}/ads/campaigns/${campaign.id}/fund`, {
        amount_minor: minor,
        idempotency_key: `${key}-${minor}`,
      })
      setCheckout(data)
    } catch (err) {
      toast.error(detail(err, "The top-up could not be started"))
    } finally {
      setBusy(false)
    }
  }

  if (checkout) {
    return (
      <PayModal
        checkout={checkout}
        title={`Add funds to ${campaign.name}`}
        description="Ad budget"
        onClose={onClose}
        onPaid={() => {
          toast.success(`${inr(checkout.taxable_minor ?? checkout.amount_minor)} added to the budget`)
          onPaid()
        }}
      >
        The budget is spent as ads are shown, at your price per 1,000 views. Whatever is left when the campaign ends comes back to you.
      </PayModal>
    )
  }

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Add funds to ${campaign.name}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={start} disabled={busy || Boolean(error)}>{busy ? "Preparing…" : "Continue to payment"}</Button>
        </div>
      }
    >
      <Field label="Amount (₹)" required error={amount ? error : undefined} hint={`Between ${inr(TOPUP_MIN)} and ${inr(TOPUP_MAX)}. GST is added at checkout.`}>
        <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <p className="mt-3 text-sm text-slate-600">
        At {inr(campaign.cpm_minor)} per 1,000 views, {minor && !error ? `this buys about ${Math.floor((minor / campaign.cpm_minor) * 1000).toLocaleString("en-IN")} ad views` : "your budget buys views as ads are shown"}.
      </p>
    </Modal>
  )
}
