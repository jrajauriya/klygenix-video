import { useState, type FormEvent } from "react"
import { Link, Navigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, CheckCircle2, FileWarning, Scale } from "lucide-react"
import { api, useAuthStore } from "@klygenixvideo/auth"
import { cn } from "@klygenixvideo/ui"
import { PageShell } from "../components/Layout"
import { Btn, Empty, Field, INPUT, Skel, TEXTAREA } from "../components/bits"
import { errText, getJson, useSignedIn } from "../lib/api"
import { longDate } from "../lib/format"
import { useTitle } from "../lib/title"
import type { MyTakedown } from "../lib/types"

const KIND_LABELS: Record<string, string> = {
  copyright: "Copyright notice",
  it_rules: "Unlawful content notice",
  intimate: "Intimate imagery notice",
  court_order: "Court or government order",
  other: "Notice",
}

const STATUS: Record<string, { label: string; tone: string }> = {
  received: { label: "Received", tone: "bg-white/10 text-ink" },
  acknowledged: { label: "Under review", tone: "bg-white/10 text-ink" },
  actioned: { label: "Content removed", tone: "bg-[#7c2d12] text-[#ffedd5]" },
  rejected: { label: "Notice rejected", tone: "bg-[#14532d] text-[#dcfce7]" },
  countered: { label: "Counter-notice filed", tone: "bg-[#1e3a8a] text-[#dbeafe]" },
  restored: { label: "Content restored", tone: "bg-[#14532d] text-[#dcfce7]" },
  upheld: { label: "Removal upheld", tone: "bg-[#7c2d12] text-[#ffedd5]" },
}

const GOOD_FAITH = "I swear under penalty of perjury that I have a good faith belief the material was removed by mistake or misidentification."
const JURISDICTION = "I consent to the jurisdiction of the court for my address and will accept service from the person who sent the notice."

function CounterForm({ notice, onFiled, onCancel }: { notice: MyTakedown; onFiled: (t: MyTakedown) => void; onCancel: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [form, setForm] = useState({
    full_name: user?.name ?? "", address: "", phone: "", email: user?.email ?? "", statement: "",
    good_faith: false, consent_jurisdiction: false, signature: "",
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const signed = form.signature.trim().toLowerCase() === form.full_name.trim().toLowerCase() && form.full_name.trim().length >= 2
  const ready = form.good_faith && form.consent_jurisdiction && signed && form.statement.trim().length >= 20

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (!signed) {
      setError("Type your full name exactly as your signature.")
      return
    }
    setPending(true)
    try {
      const { data } = await api.post<MyTakedown>(`/api/video/me/takedowns/${encodeURIComponent(notice.reference)}/counter-notice`, {
        ...form,
        full_name: form.full_name.trim(), address: form.address.trim(), phone: form.phone.trim(), email: form.email.trim(),
        statement: form.statement.trim(), signature: form.signature.trim(),
      })
      onFiled(data)
    } catch (err) {
      setError(errText(err, "The counter-notice could not be filed. Check the fields and try again."))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Counter-notice for ${notice.reference}`} className="mt-4 space-y-4 rounded-xl border border-line bg-panel p-4">
      <p className="text-sm text-muted">We send your counter-notice, including your name, address, phone and email, to the person who filed the notice so they can decide whether to go to court.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full legal name">
          <input className={INPUT} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required maxLength={200} autoComplete="email" />
        </Field>
        <Field label="Phone">
          <input className={INPUT} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} required minLength={6} maxLength={30} autoComplete="tel" />
        </Field>
        <Field label="Postal address" className="sm:col-span-2">
          <textarea className={TEXTAREA} rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} required minLength={10} maxLength={500} autoComplete="street-address" />
        </Field>
      </div>
      <Field label="Why the removal was a mistake" hint="At least 20 characters. Say what the material is and why you have the right to use it, for example your own work, a licence, or fair dealing.">
        <textarea className={TEXTAREA} rows={5} value={form.statement} onChange={(e) => set("statement", e.target.value)} required minLength={20} maxLength={5000} />
      </Field>
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={form.good_faith} onChange={(e) => set("good_faith", e.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-[#A21CAF]" />
          <span>{GOOD_FAITH}</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={form.consent_jurisdiction} onChange={(e) => set("consent_jurisdiction", e.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-[#A21CAF]" />
          <span>{JURISDICTION}</span>
        </label>
      </div>
      <Field label="Signature" hint="Type your full name exactly as above.">
        <input className={cn(INPUT, "font-serif italic")} value={form.signature} onChange={(e) => set("signature", e.target.value)} required minLength={2} maxLength={120} autoComplete="off" />
      </Field>
      {error && <p role="alert" className="rounded-xl border border-[#7f1d1d] bg-[#450a0a]/60 px-3 py-2 text-sm text-[#fecaca]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Btn tone="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn type="submit" tone="brand" disabled={pending || !ready}>{pending ? "Filing…" : "File counter-notice"}</Btn>
      </div>
    </form>
  )
}

function NoticeCard({ notice, onFiled }: { notice: MyTakedown; onFiled: (t: MyTakedown) => void }) {
  const [open, setOpen] = useState(false)
  const status = STATUS[notice.status] ?? { label: notice.status, tone: "bg-white/10 text-ink" }
  return (
    <li className="rounded-2xl border border-line bg-panel-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs font-semibold">{notice.reference}</span>
        <span className="text-sm font-semibold">{KIND_LABELS[notice.kind] ?? notice.kind}</span>
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", status.tone)}>{status.label}</span>
        <span className="ml-auto text-xs text-muted">Received {longDate(notice.received_at)}</span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[140px_1fr]">
        <dt className="text-muted">Sent by</dt>
        <dd>{notice.complainant_name}</dd>
        <dt className="text-muted">Content</dt>
        <dd className="min-w-0 break-words">
          {notice.video ? (
            notice.video.status === "published"
              ? <Link to={`/watch/${notice.video.id}`} className="font-semibold text-brand-soft hover:underline">{notice.video.title}</Link>
              : <span className="font-semibold">{notice.video.title}</span>
          ) : notice.target_url ? <span className="break-all">{notice.target_url}</span> : "—"}
        </dd>
        {notice.details && (
          <>
            <dt className="text-muted">Their claim</dt>
            <dd className="whitespace-pre-wrap break-words text-ink/85">{notice.details}</dd>
          </>
        )}
        {notice.decision_note && (
          <>
            <dt className="text-muted">Our decision</dt>
            <dd className="whitespace-pre-wrap break-words">{notice.decision_note}</dd>
          </>
        )}
      </dl>
      {notice.countered_at && (
        <div className="mt-4 flex gap-3 rounded-xl border border-[#1e40af] bg-[#172554]/60 p-3 text-sm">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#93c5fd]" aria-hidden="true" />
          <p>
            You filed a counter-notice on {longDate(notice.countered_at)}. We sent it to {notice.complainant_name}.
            {notice.restore_due_at && notice.status === "countered" && <> Unless they tell us they have gone to court, we will restore the content by <strong>{longDate(notice.restore_due_at)}</strong>.</>}
          </p>
        </div>
      )}
      {notice.can_counter && !open && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn tone="brand" size="sm" onClick={() => setOpen(true)}><Scale size={15} aria-hidden="true" /> File a counter-notice</Btn>
          <span className="text-xs text-muted">If you believe this was removed by mistake.</span>
        </div>
      )}
      {notice.can_counter && open && <CounterForm notice={notice} onCancel={() => setOpen(false)} onFiled={(t) => { setOpen(false); onFiled(t) }} />}
    </li>
  )
}

export default function CopyrightNoticesPage() {
  useTitle("Copyright notices")
  const signedIn = useSignedIn()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["my-takedowns"], enabled: signedIn, queryFn: () => getJson<MyTakedown[]>("/api/video/me/takedowns") })
  if (!signedIn) return <Navigate to={`/login?returnUrl=${encodeURIComponent("/account/notices")}`} replace />

  function filed(t: MyTakedown) {
    qc.setQueryData<MyTakedown[]>(["my-takedowns"], (rows) => rows?.map((r) => (r.reference === t.reference ? t : r)))
    toast.success(t.restore_due_at ? `Counter-notice filed. Restoration due by ${longDate(t.restore_due_at)}.` : "Counter-notice filed.")
  }

  return (
    <PageShell className="max-w-4xl">
      <Link to="/account?tab=notices" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} aria-hidden="true" /> Account notices
      </Link>
      <h1 className="text-2xl font-bold">Copyright notices</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Notices that rights holders and authorities sent about your content. If a copyright removal was a mistake, you can file a counter-notice here. Read how it works on the <Link to="/legal/copyright" className="text-brand-soft underline">copyright page</Link>.
      </p>
      <div className="mt-6">
        {q.isLoading ? (
          <div className="space-y-3"><Skel className="h-40 w-full rounded-2xl" /><Skel className="h-40 w-full rounded-2xl" /></div>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-muted">{errText(q.error, "Your notices did not load.")}</p>
        ) : !q.data?.length ? (
          <Empty icon={<FileWarning size={28} />} title="No notices about your content" body="If someone sends us a copyright or legal notice about something you posted, it shows up here." />
        ) : (
          <ul className="space-y-4">
            {q.data.map((t) => <NoticeCard key={t.reference} notice={t} onFiled={filed} />)}
          </ul>
        )}
      </div>
    </PageShell>
  )
}
