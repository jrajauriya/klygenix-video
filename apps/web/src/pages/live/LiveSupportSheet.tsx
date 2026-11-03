import { useEffect, useState, type FormEvent } from "react"
import { Loader2, MessageSquareHeart } from "lucide-react"
import { cn } from "@klygenixvideo/ui"
import { rupees } from "../../lib/format"
import { feeText } from "../../lib/support"
import type { ChannelSupport, LiveGift, SuperchatTier } from "../../lib/types"
import { Sheet } from "../../components/Sheet"
import { Btn, Field, TEXTAREA, Tabs } from "../../components/bits"
import { usePay } from "../../components/Support"
import { giftIcon } from "./gifts"

export type SupportMode = "superchat" | "gift"

export default function LiveSupportSheet({
  open, onClose, mode: initialMode, streamId, support, channelName, onPaid,
}: {
  open: boolean
  onClose: () => void
  mode: SupportMode
  streamId: string
  support: ChannelSupport
  channelName: string
  onPaid: () => unknown
}) {
  const pay = usePay()
  const tiers: SuperchatTier[] = support.superchat_tiers ?? []
  const gifts: LiveGift[] = support.gifts ?? []
  const [mode, setMode] = useState<SupportMode>(initialMode)
  const [message, setMessage] = useState("")
  const [tier, setTier] = useState<number>(tiers[1]?.tier ?? tiers[0]?.tier ?? 1)
  const [gift, setGift] = useState<string>(gifts[0]?.gift ?? "")
  const chosenTier = tiers.find((t) => t.tier === tier) ?? tiers[0]
  const chosenGift = gifts.find((g) => g.gift === gift) ?? gifts[0]

  useEffect(() => {
    if (open) setMode(initialMode)
  }, [open, initialMode])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (mode === "superchat") {
      if (!chosenTier) return
      onClose()
      await pay.start({
        body: { purpose: "superchat", stream_id: streamId, boost_tier: chosenTier.tier, message: message.trim() || undefined },
        label: `${chosenTier.label} super chat · ${channelName}`,
        done: "Your super chat is pinned in the live chat.",
        onPaid: async () => {
          setMessage("")
          await onPaid()
        },
      }, "superchat")
    } else {
      if (!chosenGift) return
      onClose()
      await pay.start({
        body: { purpose: "gift", stream_id: streamId, gift: chosenGift.gift },
        label: `${chosenGift.label} gift · ${channelName}`,
        done: `You sent ${channelName} a ${chosenGift.label}.`,
        onPaid,
      }, "gift")
    }
  }

  const price = mode === "superchat" ? chosenTier?.price_minor : chosenGift?.price_minor
  const ready = mode === "superchat" ? Boolean(chosenTier) : Boolean(chosenGift)

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={<span className="inline-flex items-center gap-2"><MessageSquareHeart size={17} className="text-[#FACC15]" aria-hidden="true" /> Support {channelName} live</span>}
        footer={
          <>
            <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
            <Btn tone="brand" type="submit" form="live-support-form" disabled={!ready || pay.busy !== null}>
              {pay.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              {mode === "superchat" ? "Send super chat" : `Send ${chosenGift?.label ?? "gift"}`} {price ? rupees(price) : ""}
            </Btn>
          </>
        }
      >
        <form id="live-support-form" onSubmit={submit} className="space-y-5">
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              ...(tiers.length ? [{ key: "superchat" as const, label: "Super chat" }] : []),
              ...(gifts.length ? [{ key: "gift" as const, label: "Gift" }] : []),
            ]}
          />
          {mode === "superchat" ? (
            <>
              <p className="text-sm text-muted">A super chat is pinned at the top of the live chat in its tier colour, for everyone watching.</p>
              <Field label="Message (optional)" hint={`${message.length}/200`}>
                <textarea className={`${TEXTAREA} resize-none`} rows={3} maxLength={200} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 200))} placeholder="Say something to the stream…" />
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-muted">Tier</legend>
                <div className="grid gap-2">
                  {tiers.map((t) => (
                    <label
                      key={t.tier}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                        tier === t.tier ? "border-brand bg-brand/15" : "border-line bg-panel-2 hover:bg-white/[0.06]",
                      )}
                    >
                      <input type="radio" name="superchat-tier" value={t.tier} checked={tier === t.tier} onChange={() => setTier(t.tier)} className="h-4 w-4 accent-[#A21CAF]" />
                      <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: t.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{t.label}</span>
                        <span className="block text-xs text-muted">Pinned for {t.pin_seconds >= 60 ? `${Math.round(t.pin_seconds / 60)} min` : `${t.pin_seconds} s`}</span>
                      </span>
                      <span className="text-sm font-bold tabular-nums">{rupees(t.price_minor)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {chosenTier && (
                <div className="rounded-xl p-3 text-black" style={{ background: chosenTier.color }}>
                  <p className="text-xs font-bold">You · {rupees(chosenTier.price_minor)}</p>
                  <p className="mt-0.5 break-words text-sm">{message.trim() || "Your message"}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted">A gift shows in the chat with your name and stays pinned for a few seconds.</p>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-muted">Gift</legend>
                <div className="grid grid-cols-3 gap-2">
                  {gifts.map((g) => (
                    <label
                      key={g.gift}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                        gift === g.gift ? "border-brand bg-brand/15" : "border-line bg-panel-2 hover:bg-white/[0.06]",
                      )}
                    >
                      <input type="radio" name="live-gift" value={g.gift} checked={gift === g.gift} onChange={() => setGift(g.gift)} className="sr-only" />
                      <span className="text-brand-soft">{giftIcon(g.gift, 26)}</span>
                      <span className="text-sm font-semibold">{g.label}</span>
                      <span className="text-xs tabular-nums text-muted">{rupees(g.price_minor)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <p className="rounded-xl bg-white/[0.05] px-3 py-2.5 text-xs leading-relaxed text-muted">
            Goes to {channelName}, minus {feeText(support)} and taxes. If the creator removes it from the chat, you get a full refund.
          </p>
        </form>
      </Sheet>
      {pay.sheet}
    </>
  )
}
