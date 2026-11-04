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
import { useT } from "../../i18n"

const RANKS = [1, 2, 3, 4, 5]

export function Memberships({ canSell }: { canSell: boolean }) {
  const t = useT()
  const { data: tiers, isLoading } = useTiers()
  const canEdit = useHasPermission("video.earnings", "full")
  const [open, setOpen] = useState<MembershipTier | "new" | null>(null)
  const rows = tiers ?? []
  const taken = rows.map((tier) => tier.rank)
  const full = RANKS.every((r) => taken.includes(r))

  return (
    <>
      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-navy">{t("Membership tiers")}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {t("Monthly memberships for your channel, up to five levels. A higher level includes every video set to a lower one.")}
            </p>
            {!canSell && <p className="mt-1 text-xs font-medium text-amber-800">{t("You can add tiers once your payouts are active.")}</p>}
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setOpen("new")} disabled={!canSell || full}>
              <Plus size={14} /> {t("New tier")}
            </Button>
          )}
        </div>
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title={t("No membership tiers yet")} hint={t("Add a tier, then set videos to members only from each video's Monetisation tab.")} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((tier) => (
              <li key={tier.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 font-num text-sm font-bold text-brand" aria-hidden="true">
                  {tier.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                    {tier.name}
                    <Badge color="purple">{tier.badge}</Badge>
                    {!tier.is_active && <Badge color="slate">{t("Off")}</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{t("Level {n}", { n: tier.rank })}{tier.perks ? ` · ${tier.perks}` : ""}</p>
                </div>
                <span className="font-num text-sm font-semibold text-navy">{inr(tier.price_minor)}<span className="text-xs font-normal text-slate-500"> {t("a month")}</span></span>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setOpen(tier)} aria-label={t("Edit {name}", { name: tier.name })}>
                    <Pencil size={13} /> {t("Edit")}
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
  const t = useT()
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
      toast.success(initial ? t("Tier saved") : t("Tier added"))
      qc.invalidateQueries({ queryKey: ["studio-tiers"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, t("Could not save the tier")))
      setBusy(null)
    }
  }

  async function toggle() {
    if (!initial) return
    const turningOff = initial.is_active
    if (turningOff) {
      const ok = await confirm({
        title: t("Turn off “{name}”?", { name: initial.name }),
        message: t("No one new can join it. Current members keep it until their month ends."),
        confirmLabel: t("Turn off"),
        variant: "destructive",
      })
      if (!ok) return
    }
    setBusy("toggle")
    try {
      await api.patch(`${STUDIO}/memberships/tiers/${initial.id}`, { is_active: !turningOff })
      toast.success(turningOff ? t("Tier turned off") : t("Tier turned on"))
      qc.invalidateQueries({ queryKey: ["studio-tiers"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, t("Could not change the tier")))
      setBusy(null)
    }
  }

  const rankOptions = (initial ? [initial.rank] : free).map((r) => ({ value: String(r), label: t("Level {n}", { n: r }) }))

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? initial.name : t("New membership tier")}
      subtitle={t("Priced per month in rupees, GST included in what viewers pay.")}
      footer={
        <DrawerFooter
          secondary={initial ? [{ label: initial.is_active ? t("Turn off") : t("Turn on"), onClick: toggle, pending: busy === "toggle", disabled: busy !== null }] : undefined}
          onCancel={onClose}
          save={{ label: initial ? t("Save") : t("Add tier"), onClick: save, pending: busy === "save", disabled: busy !== null || !name.trim() || !badge.trim() || !price }}
        />
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")} required>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Level")} hint={initial ? t("The level cannot change once a tier exists.") : t("Higher levels see everything lower levels see.")}>
            <Select value={rank} onChange={setRank} options={rankOptions} disabled={Boolean(initial)} aria-label={t("Level")} />
          </Field>
          <Field label={t("Price a month (₹)")} required error={priceError ?? undefined} hint={t("Between ₹10 and ₹50,000")}>
            <Input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label={t("Badge")} hint={t("Shown next to members' names, up to 16 characters")}>
          <Input value={badge} maxLength={16} onChange={(e) => setBadge(e.target.value)} />
        </Field>
        <Field label={t("Perks")} hint={t("What members get, in a line or two")}>
          <Textarea rows={3} value={perks} maxLength={1000} onChange={(e) => setPerks(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  )
}
