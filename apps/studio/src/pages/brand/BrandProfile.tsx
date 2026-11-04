import { useState } from "react"
import { Link } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Handshake, Megaphone, Save } from "lucide-react"
import { api } from "@klygenixvideo/auth"
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from "@klygenixvideo/ui"
import { useHasPermission } from "@klygenixvideo/client"
import { STUDIO } from "../../lib/hooks"
import { detail } from "../../lib/format"
import { GSTIN, useBrand, type Brand } from "../../lib/market"

const STATES: [string, string][] = [
  ["35", "Andaman and Nicobar Islands"], ["37", "Andhra Pradesh"], ["12", "Arunachal Pradesh"], ["18", "Assam"], ["10", "Bihar"],
  ["04", "Chandigarh"], ["22", "Chhattisgarh"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["07", "Delhi"], ["30", "Goa"],
  ["24", "Gujarat"], ["06", "Haryana"], ["02", "Himachal Pradesh"], ["01", "Jammu and Kashmir"], ["20", "Jharkhand"],
  ["29", "Karnataka"], ["32", "Kerala"], ["38", "Ladakh"], ["31", "Lakshadweep"], ["23", "Madhya Pradesh"], ["27", "Maharashtra"],
  ["14", "Manipur"], ["17", "Meghalaya"], ["15", "Mizoram"], ["13", "Nagaland"], ["21", "Odisha"], ["34", "Puducherry"],
  ["03", "Punjab"], ["08", "Rajasthan"], ["11", "Sikkim"], ["33", "Tamil Nadu"], ["36", "Telangana"], ["16", "Tripura"],
  ["09", "Uttar Pradesh"], ["05", "Uttarakhand"], ["19", "West Bengal"],
]
const STATE_OPTIONS = STATES.map(([value, label]) => ({ value, label }))

function Form({ brand }: { brand: Brand | null }) {
  const qc = useQueryClient()
  const canEdit = useHasPermission("video.brand", "full")
  const [name, setName] = useState(brand?.name ?? "")
  const [email, setEmail] = useState(brand?.contact_email ?? "")
  const [website, setWebsite] = useState(brand?.website ?? "")
  const [gstin, setGstin] = useState(brand?.gstin ?? "")
  const [state, setState] = useState(brand?.state_code ?? "")
  const [about, setAbout] = useState(brand?.about ?? "")
  const [saving, setSaving] = useState(false)

  const gst = gstin.trim().toUpperCase()
  const errors = {
    name: name && name.trim().length < 2 ? "At least two characters." : undefined,
    email: email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? "Enter a valid email address." : undefined,
    website: website.trim() && !/^https?:\/\/\S+\.\S+$/.test(website.trim()) ? "A full address starting with https://" : undefined,
    gstin: gst && !GSTIN.test(gst) ? "A GSTIN is 15 characters, like 29ABCDE1234F1Z5." : undefined,
  }
  const invalid = !name.trim() || !email.trim() || Object.values(errors).some(Boolean)

  async function save() {
    setSaving(true)
    try {
      const { data } = await api.put<{ brand: Brand }>(`${STUDIO}/brand`, {
        name: name.trim(),
        contact_email: email.trim(),
        website: website.trim() || null,
        gstin: gst || null,
        state_code: gst ? gst.slice(0, 2) : state || null,
        about: about.trim(),
      })
      qc.setQueryData(["studio-brand"], data.brand)
      toast.success(brand ? "Brand profile saved" : "Brand profile created")
    } catch (err) {
      toast.error(detail(err, "The brand profile could not be saved"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-4 p-5 lg:col-span-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-navy">Brand details</h2>
        {brand && <Badge color={brand.status === "active" ? "green" : "red"}>{brand.status === "active" ? "Active" : brand.status}</Badge>}
      </div>
      <fieldset disabled={!canEdit} className="space-y-4">
        <legend className="sr-only">Brand details</legend>
        <Field label="Brand name" required error={errors.name} hint="Shown on your ads and on every sponsored video's label.">
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Chai Point" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email" required error={errors.email} hint="Where review notes and deal updates go.">
            <Input type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Website" error={errors.website}>
            <Input value={website} maxLength={300} inputMode="url" onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint="Optional. Add it to get GST invoices you can claim input credit on.">
            <Input value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
          </Field>
          <Field label="State" hint={gst ? "Taken from your GSTIN." : "For the place of supply on invoices."}>
            <Select value={gst ? gst.slice(0, 2) : state} onChange={setState} options={STATE_OPTIONS} disabled={Boolean(gst)} placeholder="Choose a state" clearable />
          </Field>
        </div>
        <Field label="About the brand">
          <Textarea rows={3} value={about} maxLength={2000} onChange={(e) => setAbout(e.target.value)} placeholder="What you make or sell, in a line or two" />
        </Field>
      </fieldset>
      {canEdit && (
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <Button onClick={save} disabled={saving || invalid || brand?.status === "suspended"}>
            <Save size={14} /> {saving ? "Saving…" : brand ? "Save" : "Create brand profile"}
          </Button>
        </div>
      )}
    </Card>
  )
}

export default function BrandProfile() {
  const { data: brand, isLoading } = useBrand()
  if (isLoading) return <Spinner />
  return (
    <div className="pb-8">
      <PageHeader title="Brand profile" subtitle="Advertise on Klygenix Play and sponsor creators under your brand." />
      {brand?.status === "suspended" && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
          This brand account is suspended. Campaigns and briefs are paused. Contact support if you think this is a mistake.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-5 [&>*]:min-w-0">
        <Form key={brand ? "edit" : "new"} brand={brand ?? null} />
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-2 p-5 text-sm text-slate-600">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy"><Megaphone size={16} aria-hidden="true" /> Ad campaigns</h2>
            <p>Short video ads before and during long videos. You set a price per 1,000 views, add funds, and pay only for ads that are shown. Unspent money comes back when a campaign ends.</p>
            {brand && <Link to="/brand/campaigns" className="inline-block font-semibold text-brand hover:underline">Your campaigns</Link>}
          </Card>
          <Card className="space-y-2 p-5 text-sm text-slate-600">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy"><Handshake size={16} aria-hidden="true" /> Sponsorships</h2>
            <p>Post a brief, pick creators who apply, and fund the deal. The money is held until you approve the video, and every sponsored video carries a "Paid partnership" label.</p>
            {brand && <Link to="/brand/briefs" className="inline-block font-semibold text-brand hover:underline">Your briefs</Link>}
          </Card>
        </div>
      </div>
    </div>
  )
}
