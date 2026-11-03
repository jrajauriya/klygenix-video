import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Pencil, Plus } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Drawer, DrawerFooter, EmptyState, Field, Input, Select, Spinner, Textarea, useConfirm } from "@klygenixvideo/ui"
import { fromMinor, useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { detail } from "../../lib/format"
import type { MembershipTier } from "../../lib/types"
import { inr, parseRupees, priceProblem, useTiers } from "./shared"

const RANKS = [1, 2, 3, 4, 5]

export function Memberships({ canSell }: { canSell: boolean }) {
  const { data: tiers, isLoading } = useTiers()
  const canEdit = useHasPermission("video.earnings", "full")
  const [open, setOpen] = useState<MembershipTier | "new" | null>(null)
  const rows = tiers ?? []
  const taken = rows.map((t) => t.rank)
  const full = RANKS.every((r) => taken.includes(r))

  return (
    <>
      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-navy">Membership tiers</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Monthly memberships for your channel, up to five levels. A higher level includes every video set to a lower one.
            </p>
            {!canSell && <p className="mt-1 text-xs font-medium text-amber-800">You can add tiers once your payouts are active.</p>}
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setOpen("new")} disabled={!canSell || full}>
              <Plus size={14} /> New tier
            </Button>
          )}
        </div>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No membership tiers yet" hint="Add a tier, then set videos to members only from each video's Monetisation tab." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 font-num text-sm font-bold text-brand" aria-hidden="true">
                  {t.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                    {t.name}
                    <Badge color="purple">{t.badge}</Badge>
                    {!t.is_active && <Badge color="slate">Off</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">Level {t.rank}{t.perks ? ` · ${t.perks}` : ""}</p>
                </div>
                <span className="font-num text-sm font-semibold text-navy">{inr(t.price_minor)}<span className="text-xs font-normal text-slate-500"> a month</span></span>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setOpen(t)} aria-label={`Edit ${t.name}`}>
                    <Pencil size={13} /> Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open !== null && (
        <TierDrawer key={open === "new" ? "new" : open.id} initial={open === "new" ? null : open} taken={taken} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

function TierDrawer({ initial, taken, onClose }: { initial: MembershipTier | null; taken: number[]; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const free = RANKS.filter((r) => !taken.includes(r))
  const [name, setName] = useState(initial?.name ?? "")
  const [rank, setRank] = useState(String(initial?.rank ?? free[0] ?? 1))
  const [price, setPrice] = useState(initial ? fromMinor(initial.price_minor) : "")
  const [badge, setBadge] = useState(initial?.badge ?? "Member")
  const [perks, setPerks] = useState(initial?.perks ?? "")
  const [busy, setBusy] = useState<"save" | "toggle" | null>(null)
  const minor = parseRupees(price)
  const priceError = price ? priceProblem(minor) : null

  async function save() {
    const problem = priceProblem(minor)
    if (problem) {
      toast.error(problem)
      return
    }
    setBusy("save")
    try {
      const body = { name: name.trim(), price_minor: minor, perks: perks.trim(), badge: badge.trim() }
      if (initial) await api.patch(`${STUDIO}/memberships/tiers/${initial.id}`, body)
      else await api.post(`${STUDIO}/memberships/tiers`, { ...body, rank: Number(rank) })
      toast.success(initial ? "Tier saved" : "Tier added")
      qc.invalidateQueries({ queryKey: ["studio-tiers"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "Could not save the tier"))
      setBusy(null)
    }
  }

  async function toggle() {
    if (!initial) return
    const turningOff = initial.is_active
    if (turningOff) {
      const ok = await confirm({
        title: `Turn off “${initial.name}”?`,
        message: "No one new can join it. Current members keep it until their month ends.",
        confirmLabel: "Turn off",
        variant: "destructive",
      })
      if (!ok) return
    }
    setBusy("toggle")
    try {
      await api.patch(`${STUDIO}/memberships/tiers/${initial.id}`, { is_active: !turningOff })
      toast.success(turningOff ? "Tier turned off" : "Tier turned on")
      qc.invalidateQueries({ queryKey: ["studio-tiers"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "Could not change the tier"))
      setBusy(null)
    }
  }

  const rankOptions = (initial ? [initial.rank] : free).map((r) => ({ value: String(r), label: `Level ${r}` }))

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? initial.name : "New membership tier"}
      subtitle="Priced per month in rupees, GST included in what viewers pay."
      footer={
        <DrawerFooter
          secondary={initial ? [{ label: initial.is_active ? "Turn off" : "Turn on", onClick: toggle, pending: busy === "toggle", disabled: busy !== null }] : undefined}
          onCancel={onClose}
          save={{ label: initial ? "Save" : "Add tier", onClick: save, pending: busy === "save", disabled: busy !== null || !name.trim() || !badge.trim() || !price }}
        />
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level" hint={initial ? "The level cannot change once a tier exists." : "Higher levels see everything lower levels see."}>
            <Select value={rank} onChange={setRank} options={rankOptions} disabled={Boolean(initial)} aria-label="Level" />
          </Field>
          <Field label="Price a month (₹)" required error={priceError ?? undefined} hint="Between ₹10 and ₹50,000">
            <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Badge" hint="Shown next to members' names, up to 16 characters">
          <Input value={badge} maxLength={16} onChange={(e) => setBadge(e.target.value)} />
        </Field>
        <Field label="Perks" hint="What members get, in a line or two">
          <Textarea rows={3} value={perks} maxLength={1000} onChange={(e) => setPerks(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  )
}
