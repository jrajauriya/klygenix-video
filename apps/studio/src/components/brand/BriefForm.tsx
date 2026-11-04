import { useState } from "react"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Drawer, DrawerFooter, Field, Input, Select, Textarea } from "@klygenixvideo/ui"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, detail } from "../../lib/format"
import { DEAL_MIN, DELIVERABLES, type Brief, type Deliverable } from "../../lib/market"
import { inr, parseRupees } from "../earnings/shared"

export function BriefForm({ onClose, onSaved }: { onClose: () => void; onSaved: (b: Brief) => void }) {
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
    title: title && title.trim().length < 4 ? "At least four characters." : undefined,
    description: description && description.trim().length < 20 ? "At least 20 characters, so creators know what you want." : undefined,
    low: lowMinor === null || lowMinor < DEAL_MIN ? `At least ${inr(DEAL_MIN)}.` : undefined,
    high: highMinor === null || highMinor < DEAL_MIN ? `At least ${inr(DEAL_MIN)}.` : lowMinor !== null && highMinor < lowMinor ? "Must be at least the lowest budget." : undefined,
    followers: !Number.isInteger(followersN) || followersN < 0 ? "A whole number, 0 or more." : undefined,
    deadline: deadline && deadline < today ? "Pick today or a later date." : undefined,
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
      toast.success("Brief posted. Creators who match can apply now.")
      onSaved(data)
    } catch (err) {
      toast.error(detail(err, "The brief could not be posted"))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title="New sponsorship brief"
      subtitle="Creators who match see it under Sponsorships and can apply with a pitch and a price."
      footer={<DrawerFooter onCancel={onClose} save={{ label: "Post brief", onClick: save, pending: saving, disabled: invalid }} />}
    >
      <div className="space-y-4">
        <Field label="Title" required error={errors.title}>
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Review our new travel kettle" />
        </Field>
        <Field label="What you want" required error={errors.description} hint="The product, the message, anything that must or must not be said.">
          <Textarea rows={5} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Kind of content" required hint={DELIVERABLES.find((d) => d.value === deliverable)?.hint}>
          <Select value={deliverable} onChange={(v) => setDeliverable(v as Deliverable)} options={DELIVERABLES.map(({ value, label }) => ({ value, label }))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget from (₹)" required error={errors.low}>
            <Input value={low} inputMode="decimal" onChange={(e) => setLow(e.target.value)} />
          </Field>
          <Field label="Budget up to (₹)" required error={errors.high}>
            <Input value={high} inputMode="decimal" onChange={(e) => setHigh(e.target.value)} />
          </Field>
          <Field label="Minimum followers" error={errors.followers} hint="0 lets any channel apply.">
            <Input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} />
          </Field>
          <Field label="Apply by" error={errors.deadline} hint="Optional.">
            <Input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        <fieldset>
          <legend className="label">Channel languages (none picked means any)</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {LANGUAGES.map((l) => (
              <label key={l.value} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand"
                  checked={languages.includes(l.value)}
                  onChange={(e) => setLanguages(e.target.checked ? [...languages, l.value] : languages.filter((x) => x !== l.value))}
                />
                {l.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Drawer>
  )
}
