import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Scale } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { Button, Card, Field, Input, Modal, StatusPill, Textarea } from "@klygenixvideo/ui"
import { detail, when, watchUrl } from "../lib/format"

interface Notice {
  reference: string
  kind: string
  status: string
  received_at: string
  complainant_name: string
  details: string
  target_url: string
  video: { id: string; title: string; status: string } | null
  counter_notice: Record<string, unknown> | null
  countered_at: string | null
  restore_due_at: string | null
  can_counter: boolean
  decision_note: string | null
}

const KIND: Record<string, string> = {
  copyright: "Copyright",
  it_rules: "IT Rules complaint",
  intimate: "Intimate imagery",
  court_order: "Court order",
}

const STATUS: Record<string, { label: string; hex: string }> = {
  received: { label: "Received", hex: "#92400e" },
  acknowledged: { label: "Being reviewed", hex: "#1d4ed8" },
  actioned: { label: "Video taken down", hex: "#b91c1c" },
  rejected: { label: "Rejected, no action", hex: "#166534" },
  countered: { label: "Counter-notice filed", hex: "#6d28d9" },
  restored: { label: "Video restored", hex: "#166534" },
  upheld: { label: "Stays down (court action)", hex: "#b91c1c" },
}

const kindLabel = (k: string) => KIND[k] ?? k.replace(/_/g, " ")

function CounterNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [fullName, setFullName] = useState(user?.name ?? "")
  const [address, setAddress] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState(user?.email ?? "")
  const [statement, setStatement] = useState("")
  const [goodFaith, setGoodFaith] = useState(false)
  const [jurisdiction, setJurisdiction] = useState(false)
  const [signature, setSignature] = useState("")
  const [busy, setBusy] = useState(false)

  const signed = signature.trim().length > 0 && signature.trim().toLowerCase() === fullName.trim().toLowerCase()
  const ready =
    fullName.trim().length >= 2 && address.trim().length >= 10 && phone.trim().length >= 6 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && statement.trim().length >= 20 && goodFaith && jurisdiction && signed

  async function send() {
    setBusy(true)
    try {
      await api.post(`/api/video/me/takedowns/${notice.reference}/counter-notice`, {
        full_name: fullName.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        statement: statement.trim(),
        good_faith: goodFaith,
        consent_jurisdiction: jurisdiction,
        signature: signature.trim(),
      })
      toast.success("Counter-notice filed. The claimant has been sent a copy.")
      qc.invalidateQueries({ queryKey: ["video-my-takedowns"] })
      onClose()
    } catch (err) {
      toast.error(detail(err, "The counter-notice could not be filed"))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Counter-notice for ${notice.reference}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={send} disabled={busy || !ready}>{busy ? "Filing…" : "File counter-notice"}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          This is a legal statement. Your name, address, phone and email are sent to the person who complained. File it only if you
          believe the video was removed by mistake or misidentified. If they do not tell us they have gone to court, the video is
          restored after the waiting period.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full legal name" required>
            <Input value={fullName} maxLength={120} autoComplete="name" onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Phone" required>
            <Input value={phone} maxLength={30} autoComplete="tel" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email" required className="sm:col-span-2">
            <Input type="email" value={email} maxLength={200} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Postal address" required hint="Where legal papers can be served on you.">
          <Textarea rows={2} value={address} maxLength={500} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Why the removal was a mistake" required hint="At least 20 characters. Say what you own or have licensed, and how.">
          <Textarea rows={4} value={statement} maxLength={5000} onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="sr-only">Sworn statements</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
            I swear, under penalty of perjury, that I have a good faith belief the video was removed as a result of mistake or misidentification.
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={jurisdiction} onChange={(e) => setJurisdiction(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
            I consent to the jurisdiction of the court for my address, and will accept service of legal papers from the person who complained.
          </label>
        </fieldset>
        <Field label="Signature" required error={signature && !signed ? "Type your full legal name exactly as above." : undefined}
          hint="Type your full legal name to sign.">
          <Input value={signature} maxLength={120} onChange={(e) => setSignature(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function Notices() {
  const [countering, setCountering] = useState<Notice | null>(null)
  const { data } = useQuery({
    queryKey: ["video-my-takedowns"],
    queryFn: async () => (await api.get<Notice[]>("/api/video/me/takedowns")).data,
  })
  if (!data?.length) return null

  return (
    <Card className="mt-5 p-0">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <Scale size={16} className="text-slate-500" aria-hidden="true" />
        <h2 className="text-sm font-bold text-navy">Legal notices about your videos</h2>
      </div>
      <ul className="divide-y divide-slate-100">
        {data.map((n) => {
          const s = STATUS[n.status] ?? { label: n.status, hex: "#475569" }
          return (
            <li key={n.reference} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="font-num">{n.reference}</span> · {kindLabel(n.kind)} · from {n.complainant_name}
                </p>
                {n.video ? (
                  <a href={watchUrl(n.video.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                    {n.video.title} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : (
                  <p className="break-all text-sm text-slate-600">{n.target_url}</p>
                )}
                <p className="whitespace-pre-line text-sm text-slate-600">{n.details}</p>
                {n.decision_note && <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">Decision: {n.decision_note}</p>}
                <p className="text-xs text-slate-500">
                  Received {when(n.received_at, true)}
                  {n.countered_at ? ` · counter-notice filed ${when(n.countered_at, true)}` : ""}
                  {n.status === "countered" && n.restore_due_at ? ` · restored on ${when(n.restore_due_at)} unless the claimant goes to court` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusPill label={s.label} hex={s.hex} />
                {n.can_counter && <Button size="sm" variant="outline" onClick={() => setCountering(n)}>File a counter-notice</Button>}
              </div>
            </li>
          )
        })}
      </ul>
      {countering && <CounterNotice notice={countering} onClose={() => setCountering(null)} />}
    </Card>
  )
}
