import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { api } from "@klygenixvideo/auth"
import { Drawer, DrawerFooter, Field, Input, Select, cn } from "@klygenixvideo/ui"
import { fromMinor } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { LANGUAGES, clock, detail, fromLocalInput, toLocalInput } from "../../lib/format"
import { CPM_MIN, DEVICES, categoryLabel, useAdCategories, usePublishedVideos, type Campaign } from "../../lib/market"
import { inr, parseRupees } from "../earnings/shared"
import { useT } from "../../i18n"

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
  const t = useT()
  const targeting = campaign?.targeting ?? {}
  const [name, setName] = useState(campaign?.name ?? "")
  const [creative, setCreative] = useState(campaign?.creative?.id ?? "")
  const [clickUrl, setClickUrl] = useState(campaign?.click_url ?? "https://")
  const [cpm, setCpm] = useState(campaign ? fromMinor(campaign.cpm_minor) : "100")
  const [cap, setCap] = useState(campaign?.daily_cap_minor ? fromMinor(campaign.daily_cap_minor) : "")
  const [start, setStart] = useState(toLocalInput(campaign?.start_at))
  const [end, setEnd] = useState(toLocalInput(campaign?.end_at))
  const [countries, setCountries] = useState((targeting.countries ?? []).join(", "))
  const [languages, setLanguages] = useState<string[]>(targeting.languages ?? [])
  const [devices, setDevices] = useState<string[]>(targeting.devices ?? [])
  const [excluded, setExcluded] = useState<string[]>(campaign?.exclude_categories ?? [])
  const { data: categories } = useAdCategories()
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
    name: name.trim().length < 2 ? t("At least two characters.") : undefined,
    click: /^https:\/\/[^\s.]+\.[^\s]+$/.test(clickUrl.trim()) ? undefined : t("A full https:// address."),
    cpm: cpmMinor === null || cpmMinor < CPM_MIN ? t("At least {amount} per 1,000 views.", { amount: inr(CPM_MIN) }) : undefined,
    cap: cap.trim() && (capMinor === null || capMinor < 100) ? t("Leave empty, or at least ₹1.") : undefined,
    end: start && end && new Date(end) <= new Date(start) ? t("The end must be after the start.") : undefined,
    countries: countryList.some((c) => !/^[A-Z]{2}$/.test(c)) ? t("Two-letter country codes, like IN, AE, GB.") : undefined,
  }
  const invalid = Object.values(errors).some(Boolean)
  const uploadHint = t("You can save a draft without one. {link}, wait for it to publish, then pick it here.").split("{link}")

  async function save() {
    if (invalid) {
      toast.error(t("Fix the highlighted fields first"))
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
      exclude_categories: excluded,
    }
    try {
      const { data } = campaign
        ? await api.put<Campaign>(`${STUDIO}/ads/campaigns/${campaign.id}`, body)
        : await api.post<Campaign>(`${STUDIO}/ads/campaigns`, body)
      toast.success(campaign ? t("Campaign saved") : t("Campaign created as a draft"))
      onSaved(data)
    } catch (err) {
      toast.error(detail(err, t("The campaign could not be saved")))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={campaign ? t("Edit {name}", { name: campaign.name }) : t("New ad campaign")}
      subtitle={t("Campaigns start as drafts. Submit one for review when it is ready.")}
      footer={<DrawerFooter onCancel={onClose} save={{ label: campaign ? t("Save") : t("Create draft"), onClick: save, pending: saving, disabled: invalid }} />}
    >
      <div className="space-y-4">
        <Field label={t("Campaign name")} required error={name ? errors.name : undefined}>
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("Monsoon launch")} />
        </Field>

        <Field label={t("Ad video")} hint={t("One of your own published videos, 60 seconds or less. Upload it as an unlisted video so it only plays as an ad.")}>
          <Select
            value={creative}
            onChange={setCreative}
            options={creativeOptions}
            clearable
            placeholder={videosLoading ? t("Loading your videos…") : creativeOptions.length ? t("Choose a video") : t("No eligible videos yet")}
          />
        </Field>
        {!videosLoading && creativeOptions.length === 0 && (
          <p className="-mt-2 text-xs text-slate-600">
            {uploadHint[0]}<Link to="/videos?upload=1" className="font-semibold text-brand hover:underline">{t("Upload the ad")}</Link>{uploadHint[1]}
          </p>
        )}

        <Field label={t("Where a click goes")} required error={clickUrl !== "https://" ? errors.click : undefined}>
          <Input value={clickUrl} maxLength={500} inputMode="url" onChange={(e) => setClickUrl(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Price per 1,000 views (₹)")} required error={errors.cpm}
            hint={paused ? t("Cannot change while the campaign is paused.") : t("At least {amount}. You pay only for ads that are shown.", { amount: inr(CPM_MIN) })}>
            <Input value={cpm} inputMode="decimal" disabled={paused} onChange={(e) => setCpm(e.target.value)} />
          </Field>
          <Field label={t("Daily spending cap (₹)")} error={errors.cap} hint={t("Optional. Leave empty for no cap.")}>
            <Input value={cap} inputMode="decimal" onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Field label={t("Starts")} hint={t("Optional. Empty means as soon as it is approved.")}>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t("Ends")} error={errors.end} hint={t("Optional. Empty means until the budget runs out.")}>
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label={t("Countries")} error={errors.countries} hint={t("Two-letter codes separated by commas. Empty means everywhere.")}>
          <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="IN, AE" />
        </Field>
        <Chips legend={t("Viewer languages (none picked means any)")} options={LANGUAGES.map((o) => ({ ...o, label: t(o.label) }))} value={languages} onChange={setLanguages} />
        <Chips legend={t("Devices (none picked means all)")} options={DEVICES.map((o) => ({ ...o, label: t(o.label) }))} value={devices} onChange={setDevices} />
        {(categories?.length ?? 0) > 0 && (
          <div>
            <Chips
              legend={t("Exclude categories")}
              options={(categories ?? []).map((c) => ({ value: c, label: categoryLabel(c) }))}
              value={excluded}
              onChange={setExcluded}
            />
            <p className="mt-1 text-xs text-slate-500">{t("Your ad never plays on videos in these categories. Videos made for kids never show ads.")}</p>
          </div>
        )}
      </div>
    </Drawer>
  )
}
