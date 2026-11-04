import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Drawer, DrawerFooter, Field, Input, Select, cn } from "@klygenixvideo/ui"
import { fromMinor } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, clock, detail, fromLocalInput, toLocalInput } from "../../lib/format"
import { CPM_MIN, DEVICES, usePublishedVideos, type Campaign } from "../../lib/market"
import { inr, parseRupees } from "../earnings/shared"

const MAX_AD_MS = 60_000

function Chips({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value)
          return (
            <label
              key={o.value}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold",
                on ? "border-brand bg-brand-50 text-navy" : "border-slate-300 text-slate-600 hover:border-slate-400",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function CampaignForm({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null
  onClose: () => void
  onSaved: (c: Campaign) => void
}) {
  const t = campaign?.targeting ?? {}
  const [name, setName] = useState(campaign?.name ?? "")
  const [creative, setCreative] = useState(campaign?.creative?.id ?? "")
  const [clickUrl, setClickUrl] = useState(campaign?.click_url ?? "https://")
  const [cpm, setCpm] = useState(campaign ? fromMinor(campaign.cpm_minor) : "100")
  const [cap, setCap] = useState(campaign?.daily_cap_minor ? fromMinor(campaign.daily_cap_minor) : "")
  const [start, setStart] = useState(toLocalInput(campaign?.start_at))
  const [end, setEnd] = useState(toLocalInput(campaign?.end_at))
  const [countries, setCountries] = useState((t.countries ?? []).join(", "))
  const [languages, setLanguages] = useState<string[]>(t.languages ?? [])
  const [devices, setDevices] = useState<string[]>(t.devices ?? [])
  const [saving, setSaving] = useState(false)
  const { data: videos, isLoading: videosLoading } = usePublishedVideos()

  const paused = campaign?.status === "paused"
  const eligible = (videos ?? []).filter((v) => v.source !== "embed" && (v.duration_ms ?? 0) <= MAX_AD_MS)
  const creativeOptions = eligible.map((v) => ({ value: v.public_id, label: v.title, hint: clock(v.duration_ms) }))
  if (campaign?.creative && !creativeOptions.some((o) => o.value === campaign.creative!.id)) {
    creativeOptions.unshift({ value: campaign.creative.id, label: campaign.creative.title, hint: clock(campaign.creative.duration_ms) })
  }

  const cpmMinor = parseRupees(cpm)
  const capMinor = cap.trim() ? parseRupees(cap) : null
  const countryList = countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)
  const errors = {
    name: name.trim().length < 2 ? "At least two characters." : undefined,
    click: /^https:\/\/[^\s.]+\.[^\s]+$/.test(clickUrl.trim()) ? undefined : "A full https:// address.",
    cpm: cpmMinor === null || cpmMinor < CPM_MIN ? `At least ${inr(CPM_MIN)} per 1,000 views.` : undefined,
    cap: cap.trim() && (capMinor === null || capMinor < 100) ? "Leave empty, or at least ₹1." : undefined,
    end: start && end && new Date(end) <= new Date(start) ? "The end must be after the start." : undefined,
    countries: countryList.some((c) => !/^[A-Z]{2}$/.test(c)) ? "Two-letter country codes, like IN, AE, GB." : undefined,
  }
  const invalid = Object.values(errors).some(Boolean)

  async function save() {
    if (invalid) {
      toast.error("Fix the highlighted fields first")
      return
    }
    setSaving(true)
    const body = {
      name: name.trim(),
      creative_video_id: creative || null,
      click_url: clickUrl.trim(),
      cpm_minor: cpmMinor,
      daily_cap_minor: capMinor,
      start_at: fromLocalInput(start),
      end_at: fromLocalInput(end),
      countries: countryList,
      languages,
      devices,
    }
    try {
      const { data } = campaign
        ? await api.put<Campaign>(`${STUDIO}/ads/campaigns/${campaign.id}`, body)
        : await api.post<Campaign>(`${STUDIO}/ads/campaigns`, body)
      toast.success(campaign ? "Campaign saved" : "Campaign created as a draft")
      onSaved(data)
    } catch (err) {
      toast.error(detail(err, "The campaign could not be saved"))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={campaign ? `Edit ${campaign.name}` : "New ad campaign"}
      subtitle="Campaigns start as drafts. Submit one for review when it is ready."
      footer={<DrawerFooter onCancel={onClose} save={{ label: campaign ? "Save" : "Create draft", onClick: save, pending: saving, disabled: invalid }} />}
    >
      <div className="space-y-4">
        <Field label="Campaign name" required error={name ? errors.name : undefined}>
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Monsoon launch" />
        </Field>

        <Field label="Ad video" hint="One of your own published videos, 60 seconds or less. Upload it as an unlisted video so it only plays as an ad.">
          <Select
            value={creative}
            onChange={setCreative}
            options={creativeOptions}
            clearable
            placeholder={videosLoading ? "Loading your videos…" : creativeOptions.length ? "Choose a video" : "No eligible videos yet"}
          />
        </Field>
        {!videosLoading && creativeOptions.length === 0 && (
          <p className="-mt-2 text-xs text-slate-600">
            You can save a draft without one. <Link to="/videos?upload=1" className="font-semibold text-brand hover:underline">Upload the ad</Link>, wait for it to publish, then pick it here.
          </p>
        )}

        <Field label="Where a click goes" required error={clickUrl !== "https://" ? errors.click : undefined}>
          <Input value={clickUrl} maxLength={500} inputMode="url" onChange={(e) => setClickUrl(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price per 1,000 views (₹)" required error={errors.cpm}
            hint={paused ? "Cannot change while the campaign is paused." : `At least ${inr(CPM_MIN)}. You pay only for ads that are shown.`}>
            <Input value={cpm} inputMode="decimal" disabled={paused} onChange={(e) => setCpm(e.target.value)} />
          </Field>
          <Field label="Daily spending cap (₹)" error={errors.cap} hint="Optional. Leave empty for no cap.">
            <Input value={cap} inputMode="decimal" onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Field label="Starts" hint="Optional. Empty means as soon as it is approved.">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends" error={errors.end} hint="Optional. Empty means until the budget runs out.">
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="Countries" error={errors.countries} hint="Two-letter codes separated by commas. Empty means everywhere.">
          <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IN, AE" />
        </Field>
        <Chips legend="Viewer languages (none picked means any)" options={LANGUAGES} value={languages} onChange={setLanguages} />
        <Chips legend="Devices (none picked means all)" options={DEVICES} value={devices} onChange={setDevices} />
      </div>
    </Drawer>
  )
}
