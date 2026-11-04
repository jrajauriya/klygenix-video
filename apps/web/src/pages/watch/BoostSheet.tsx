import { useEffect, useState, type FormEvent } from "react"
import { Loader2, Rocket } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { errText } from "../../lib/api"
import { clock, rupees } from "../../lib/format"
import { Sheet } from "../../components/Sheet"
import { Btn, INPUT } from "../../components/bits"
import { usePay } from "../../components/Support"
import type { BoostOptions } from "./DanmakuBar"
import { useT } from "../../i18n"

export default function BoostSheet({ open, onClose, boost, tMs, initial, onPaid }: { open: boolean; onClose: () => void; boost: BoostOptions; tMs: number; initial: string; onPaid: () => void }) {
  const t = useT("watchx")
  const pay = usePay()
  const [text, setText] = useState("")
  const [tier, setTier] = useState<number>(boost.tiers[1]?.tier ?? boost.tiers[0]?.tier ?? 1)
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const chosen = boost.tiers.find((x) => x.tier === tier) ?? boost.tiers[0]

  useEffect(() => {
    if (open) {
      setText(initial.trim().slice(0, 60))
      setProblem(null)
    }
  }, [open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value || !chosen) return
    setChecking(true)
    setProblem(null)
    let clean = value
    try {
      const { data } = await api.post<{ ok: boolean; text: string }>(`/api/video/videos/${boost.videoId}/boost/check`, { text: value })
      clean = data.text || value
    } catch (err) {
      setProblem(errText(err, t("That text can't be boosted.")))
      setChecking(false)
      return
    }
    setChecking(false)
    onClose()
    await pay.start({
      body: { purpose: "boost", video_id: boost.videoId, boost_tier: chosen.tier, text: clean, t_ms: Math.max(0, Math.round(tMs)) },
      label: t("{tier} boost at {time}", { tier: chosen.label, time: clock(tMs) }),
      done: t("Your boosted danmaku is live."),
      onPaid,
    }, "boost")
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={<span className="inline-flex items-center gap-2"><Rocket size={17} className="text-[#FACC15]" aria-hidden="true" /> {t("Boost a danmaku")}</span>}
        footer={
          <>
            <Btn tone="ghost" onClick={onClose}>{t("Cancel")}</Btn>
            <Btn tone="brand" type="submit" form="boost-form" disabled={!text.trim() || !chosen || checking || pay.busy !== null}>
              {checking || pay.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              {t("Boost {price}", { price: chosen ? rupees(chosen.price_minor) : "" }).trim()}
            </Btn>
          </>
        }
      >
        <form id="boost-form" onSubmit={submit} className="space-y-5">
          <p className="text-sm text-muted">{t("A boosted line is pinned at the top of the video at {time}, in its tier colour, for everyone watching.", { time: clock(tMs) })}</p>
          <label className="block space-y-1.5">
            <span className="flex justify-between text-sm font-medium text-muted">{t("Your line")} <span className="tabular-nums text-faint">{text.length}/60</span></span>
            <input
              className={INPUT}
              value={text}
              onChange={(e) => { setText(e.target.value.slice(0, 60)); setProblem(null) }}
              maxLength={60}
              placeholder={t("Say something big…")}
              aria-invalid={problem ? true : undefined}
            />
          </label>
          {problem && <p role="alert" className="rounded-xl border border-[#f97316]/40 bg-[#7c2d12]/30 px-3 py-2 text-sm text-[#fed7aa]">{problem}</p>}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted">{t("Tier")}</legend>
            <div className="grid gap-2">
              {boost.tiers.map((x) => (
                <label
                  key={x.tier}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    tier === x.tier ? "border-brand bg-brand/15" : "border-line bg-panel-2 hover:bg-white/[0.06]",
                  )}
                >
                  <input type="radio" name="boost-tier" value={x.tier} checked={tier === x.tier} onChange={() => setTier(x.tier)} className="h-4 w-4 accent-[#A21CAF]" />
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: x.color, boxShadow: `0 0 8px ${x.color}` }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{x.label}</span>
                    <span className="block text-xs text-muted">{t("Pinned for {s} s", { s: Math.round(x.pin_ms / 1000) })}</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{rupees(x.price_minor)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {chosen && text.trim() && (
            <div className="flex justify-center rounded-xl bg-black px-3 py-4" aria-hidden="true">
              <span
                className="max-w-full truncate rounded-full px-3 py-1 text-base font-bold"
                style={{ color: chosen.color, border: `1.5px solid ${chosen.color}`, background: "rgba(0,0,0,.6)", boxShadow: `0 0 14px ${chosen.color}66` }}
              >
                ✦ {text.trim()}
              </span>
            </div>
          )}
        </form>
      </Sheet>
      {pay.sheet}
    </>
  )
}
