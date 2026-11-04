import { useState } from "react"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Drawer, DrawerFooter, Field, Input, Select, Textarea } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, detail } from "../../lib/format"
import { DEAL_MIN, DELIVERABLES, type Brief, type Deliverable } from "../../lib/market"
import { inr, parseRupees } from "../earnings/shared"
import { useT } from "../../i18n"

export function BriefForm({ onClose, onSaved }: { onClose: () => void; onSaved: (b: Brief) => void }) {
  const t = useT()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [deliverable, setDeliverable] = useState<Deliverable>("integration")
  const [low, setLow] = useState("5000")
  const [high, setHigh] = useState("15000")
  const [languages, setLanguages] = useState<string[]>([])
  const [followers, setFollowers] = useState("0")
  const [deadline, setDeadline] = useState("")
  const [saving, setSaving] = useState(false)

  const lowMinor = parseRupees(low)
  const highMinor = parseRupees(high)
  const followersN = Number(followers)
  const today = new Date().toISOString().slice(0, 10)
  const errors = {
    title: title && title.trim().length < 4 ? t("At least four characters.") : undefined,
    description: description && description.trim().length < 20 ? t("At least 20 characters, so creators know what you want.") : undefined,
    low: lowMinor === null || lowMinor < DEAL_MIN ? t("At least {amount}.", { amount: inr(DEAL_MIN) }) : undefined,
    high: highMinor === null || highMinor < DEAL_MIN ? t("At least {amount}.", { amount: inr(DEAL_MIN) }) : lowMinor !== null && highMinor < lowMinor ? t("Must be at least the lowest budget.") : undefined,
    followers: !Number.isInteger(followersN) || followersN < 0 ? t("A whole number, 0 or more.") : undefined,
    deadline: deadline && deadline < today ? t("Pick today or a later date.") : undefined,
  }
  const invalid = title.trim().length < 4 || description.trim().length < 20 || Object.values(errors).some(Boolean)

  async function save() {
    setSaving(true)
    try {
      const { data } = await api.post<Brief>(`${STUDIO}/sponsorships/briefs`, {
        title: title.trim(),
        description: description.trim(),
        deliverable,
        budget_min_minor: lowMinor,
        budget_max_minor: highMinor,
        languages,
        min_followers: followersN,
        deadline: deadline || null,
      })
      toast.success(t("Brief posted. Creators who match can apply now."))
      onSaved(data)
    } catch (err) {
      toast.error(detail(err, t("The brief could not be posted")))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={t("New sponsorship brief")}
      subtitle={t("Creators who match see it under Sponsorships and can apply with a pitch and a price.")}
      footer={<DrawerFooter onCancel={onClose} save={{ label: t("Post brief"), onClick: save, pending: saving, disabled: invalid }} />}
    >
      <div className="space-y-4">
        <Field label={t("Title")} required error={errors.title}>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={t("Review our new travel kettle")} />
        </Field>
        <Field label={t("What you want")} required error={errors.description} hint={t("The product, the message, anything that must or must not be said.")}>
          <Textarea rows={5} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("Kind of content")} required hint={(() => { const hint = DELIVERABLES.find((d) => d.value === deliverable)?.hint; return hint ? t(hint) : undefined })()}>
          <Select value={deliverable} onChange={(v) => setDeliverable(v as Deliverable)} options={DELIVERABLES.map(({ value, label }) => ({ value, label: t(label) }))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Budget from (₹)")} required error={errors.low}>
            <Input value={low} inputMode="decimal" onChange={(e) => setLow(e.target.value)} />
          </Field>
          <Field label={t("Budget up to (₹)")} required error={errors.high}>
            <Input value={high} inputMode="decimal" onChange={(e) => setHigh(e.target.value)} />
          </Field>
          <Field label={t("Minimum followers")} error={errors.followers} hint={t("0 lets any channel apply.")}>
            <Input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} />
          </Field>
          <Field label={t("Apply by")} error={errors.deadline} hint={t("Optional.")}>
            <Input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        <fieldset>
          <legend className="label">{t("Channel languages (none picked means any)")}</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {LANGUAGES.map((l) => (
              <label key={l.value} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand"
                  checked={languages.includes(l.value)}
                  onChange={(e) => setLanguages(e.target.checked ? [...languages, l.value] : languages.filter((x) => x !== l.value))}
                />
                {t(l.label)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  )
}
