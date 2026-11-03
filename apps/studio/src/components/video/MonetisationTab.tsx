import { useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Select, Spinner, cn } from "@klygenixvideo/ui"
import { fromMinor, useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { detail } from "../../lib/format"
import type { StudioVideoDetail, VideoAccess } from "../../lib/types"
import { PayoutsOff, inr, parseRupees, priceProblem, useEarnings, useTiers } from "../earnings/shared"

type Saved = { access: VideoAccess; price_minor: number | null; members_rank: number | null; preview_seconds: number | null }

const OPTIONS: { value: VideoAccess; label: string; hint: string }[] = [
  { value: "free", label: "Free", hint: "Anyone can watch the whole video." },
  { value: "members", label: "Members only", hint: "Channel members at or above a level you pick." },
  { value: "paid", label: "Paid", hint: "Viewers buy it once and keep it." },
]

export function MonetisationTab({ video }: { video: StudioVideoDetail }) {
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.earnings", "full")
  const { data: earnings, isLoading } = useEarnings()
  const { data: tiers } = useTiers()
  const [saved, setSaved] = useState<Saved>({
    access: video.access ?? "free",
    price_minor: video.price_minor ?? null,
    members_rank: video.members_rank ?? null,
    preview_seconds: video.preview_seconds ?? null,
  })
  const [access, setAccess] = useState<VideoAccess>(saved.access)
  const [price, setPrice] = useState(saved.price_minor ? fromMinor(saved.price_minor) : "")
  const [rank, setRank] = useState(String(saved.members_rank ?? 1))
  const [preview, setPreview] = useState(String(saved.preview_seconds ?? 60))
  const [saving, setSaving] = useState(false)

  if (isLoading) return <Spinner />

  const embed = video.source === "embed"
  const canSell = Boolean(earnings?.can_take_money)
  const active = (tiers ?? []).filter((t) => t.is_active)
  const tierOptions = active.map((t) => ({ value: String(t.rank), label: `Level ${t.rank} · ${t.name}`, hint: `${inr(t.price_minor)} a month` }))
  const minor = parseRupees(price)
  const previewN = Number(preview)
  const previewError = preview !== "" && (!Number.isInteger(previewN) || previewN < 0 || previewN > 300) ? "Between 0 and 300 seconds." : undefined
  const priceError = access === "paid" && price ? priceProblem(minor) ?? undefined : undefined
  const locked = embed || !canEdit

  async function save() {
    if (access === "paid") {
      const p = priceProblem(minor)
      if (p) {
        toast.error(p)
        return
      }
    }
    if (access === "members" && !active.some((t) => t.rank <= Number(rank))) {
      toast.error("Add a membership tier at this level or lower first.")
      return
    }
    setSaving(true)
    try {
      const { data } = await api.put<Saved>(`${STUDIO}/videos/${video.id}/access`, {
        access,
        price_minor: access === "paid" ? minor : undefined,
        members_rank: access === "members" ? Number(rank) : undefined,
        preview_seconds: preview === "" ? undefined : previewN,
      })
      setSaved(data)
      toast.success(data.access === "free" ? "Free for everyone" : data.access === "paid" ? `Priced at ${inr(data.price_minor)}` : "Members only")
      qc.invalidateQueries({ queryKey: ["studio-video", String(video.id)] })
      qc.invalidateQueries({ queryKey: ["studio-videos"] })
    } catch (err) {
      toast.error(detail(err, "Could not change who can watch"))
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    access !== saved.access ||
    (access === "paid" && minor !== saved.price_minor) ||
    (access === "members" && Number(rank) !== saved.members_rank) ||
    (preview !== "" && previewN !== saved.preview_seconds)

  return (
    <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
      <Card className="space-y-5 p-5 lg:col-span-3">
        <div>
          <h2 className="text-sm font-bold text-navy">Who can watch</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {saved.access === "free" ? "Free for everyone right now." : saved.access === "paid" ? `Paid, ${inr(saved.price_minor)}, right now.` : `Members at level ${saved.members_rank} and above, right now.`}
          </p>
        </div>

        {embed && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700">
            This video is linked from {video.embed_platform === "bilibili" ? "Bilibili" : "YouTube"}, where it is free to watch, so it cannot be priced or made members only here.
          </p>
        )}
        {!embed && !canSell && (
          <PayoutsOff>Members-only and paid videos are off until your payouts are active.</PayoutsOff>
        )}

        <fieldset disabled={locked} className="space-y-2">
          <legend className="sr-only">Access</legend>
          {OPTIONS.map((o) => {
            const off = locked || (o.value !== "free" && !canSell)
            return (
              <label key={o.value}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3.5 py-3",
                  access === o.value ? "border-brand bg-brand-50" : "border-slate-200",
                  off ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-slate-300",
                )}>
                <input type="radio" name="access" value={o.value} checked={access === o.value} disabled={off}
                  onChange={() => setAccess(o.value)} className="mt-1" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-navy">{o.label}</span>
                  <span className="block text-xs text-slate-600">{o.hint}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        {access === "members" && !embed && (
          tierOptions.length === 0 ? (
            <p className="text-sm text-slate-600">
              You have no active membership tiers. <Link to="/earnings?tab=memberships" className="font-semibold text-brand hover:underline">Add one under Earnings</Link>.
            </p>
          ) : (
            <Field label="Lowest level that can watch">
              <Select value={rank} onChange={setRank} options={tierOptions} disabled={locked || !canSell} aria-label="Lowest level that can watch" />
            </Field>
          )
        )}
        {access === "paid" && !embed && (
          <Field label="Price (₹)" required error={priceError} hint="Between ₹10 and ₹50,000, GST included">
            <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} disabled={locked || !canSell} className="max-w-[12rem]" />
          </Field>
        )}
        {access !== "free" && !embed && (
          <Field label="Free preview (seconds)" error={previewError} hint="Everyone can watch this much before they are asked to join or buy. 0 to 300.">
            <Input type="number" min={0} max={300} step={5} value={preview} onChange={(e) => setPreview(e.target.value)} disabled={locked} className="max-w-[12rem]" />
          </Field>
        )}

        {!embed && canEdit && (
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button onClick={save} disabled={saving || !dirty || Boolean(previewError) || Boolean(priceError) || (access !== "free" && !canSell)}>
              <Save size={14} /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-2 p-5 text-sm text-slate-600 lg:col-span-2">
        <h2 className="text-sm font-bold text-navy">How it works</h2>
        <p>Klygenix Play keeps {earnings ? earnings.commission_bps / 100 : 20}% commission plus GST. Your share is held for the {earnings?.refund_window_days ?? 7}-day refund window, then released to your bank.</p>
        <p>Viewers who bought a video, or are members at the right level, see it in full. Everyone else sees the preview.</p>
        <p>Captions, AI chapters and Ask-the-video work the same for everyone who can watch.</p>
        <Link to="/earnings" className="inline-block font-semibold text-brand hover:underline">See your earnings</Link>
      </Card>
    </div>
  )
}
